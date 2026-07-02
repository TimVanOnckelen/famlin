import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, createComment, authHeader } from './helpers.js';

// The API only accepts assetUrl/uploadedAssetUrls matching the app's
// /uploads/<uuid>.<ext> upload path format (see UPLOAD_PATH_REGEX in
// types.ts) — arbitrary strings like "/uploads/a.jpg" fail schema
// validation before the route's own business logic ever runs.
const assetPath = () => `/uploads/${randomUUID()}.jpg`;

describe('comments routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('group membership isolation', () => {
    it('rejects a non-member reading comments', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(outsider),
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects a non-member posting a comment', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(outsider),
        payload: { content: 'sneaky comment' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('authorization on mutation', () => {
    it('rejects a non-author editing another member\'s comment', async () => {
      const author = await createUser();
      const otherMember = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, otherMember.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await createComment({ postId: post.id, authorId: author.id });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(otherMember),
        payload: { content: 'hijacked' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('lets an admin delete another member\'s comment', async () => {
      const author = await createUser();
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await createComment({ postId: post.id, authorId: author.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(admin),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('assetUrl pinning', () => {
    it('rejects pinning a comment to an asset that is not on the post', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id, uploadedAssetUrls: [assetPath()] });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { content: 'nice photo', assetUrl: assetPath() },
      });

      expect(res.statusCode).toBe(400);
    });

    it('a reply inherits the parent comment\'s pinned assetUrl, ignoring any client override', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const [assetA, assetB] = [assetPath(), assetPath()];
      const post = await createPost({ groupId: group.id, authorId: author.id, uploadedAssetUrls: [assetA, assetB] });

      const parent = await createComment({ postId: post.id, authorId: author.id, assetUrl: assetA });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { content: 'a reply', parentId: parent.id, assetUrl: assetB },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().assetUrl).toBe(assetA);
    });

    it('filters comments by assetUrl when provided', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const [assetA, assetB] = [assetPath(), assetPath()];
      const post = await createPost({ groupId: group.id, authorId: author.id, uploadedAssetUrls: [assetA, assetB] });

      await createComment({ postId: post.id, authorId: author.id, assetUrl: assetA, content: 'on a' });
      await createComment({ postId: post.id, authorId: author.id, content: 'post-level' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}/comments?assetUrl=${encodeURIComponent(assetA)}`,
        headers: authHeader(author),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0].content).toBe('on a');
    });
  });

  describe('soft delete', () => {
    it('rejects replying to a soft-deleted parent comment', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const parent = await createComment({ postId: post.id, authorId: author.id });

      await app.inject({ method: 'DELETE', url: `/api/comments/${parent.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { content: 'too late', parentId: parent.id },
      });

      expect(res.statusCode).toBe(404);
    });

    it('hides replies whose parent comment was soft-deleted from the listing', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const parent = await createComment({ postId: post.id, authorId: author.id });
      const reply = await createComment({ postId: post.id, authorId: author.id, parentId: parent.id });

      await app.inject({ method: 'DELETE', url: `/api/comments/${parent.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
      });

      const ids = res.json().map((c: { id: string }) => c.id);
      expect(ids).not.toContain(parent.id);
      expect(ids).not.toContain(reply.id);
    });
  });
});
