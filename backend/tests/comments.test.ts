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

  describe('comment attachments', () => {
    it('creates a photo-only comment with no text content', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const photoUrl = assetPath();
      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrl: photoUrl },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe('');
      expect(res.json().attachmentUrl).toBe(photoUrl);
      expect(res.json().attachmentUrls).toEqual([photoUrl]);
    });

    it('creates a comment with several photos and mirrors the first onto attachmentUrl', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const photoUrls = [assetPath(), assetPath(), assetPath()];
      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrls: photoUrls },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().attachmentUrls).toEqual(photoUrls);
      // Clients built before multi-attachment comments only read this field.
      expect(res.json().attachmentUrl).toBe(photoUrls[0]);

      const list = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
      });
      expect(list.json()[0].attachmentUrls).toEqual(photoUrls);
    });

    it('drops a duplicate attachment path', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const photoUrl = assetPath();
      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrls: [photoUrl, photoUrl] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().attachmentUrls).toEqual([photoUrl]);
    });

    it('rejects more attachments than a comment may carry', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrls: Array.from({ length: 11 }, assetPath) },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an attachmentUrls entry that is not a valid uploaded asset path', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrls: [assetPath(), 'https://evil.example.com/x.jpg'] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects a comment with neither content nor an attachment', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an attachmentUrl that is not a valid uploaded asset path', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${post.id}/comments`,
        headers: authHeader(author),
        payload: { attachmentUrl: 'https://evil.example.com/x.jpg' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('editing attachments', () => {
    // Creating through the route rather than the fixture so both attachment
    // columns are populated the way a real comment's are.
    async function postComment(app: FastifyInstance, postId: string, user: any, payload: object) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${postId}/comments`,
        headers: authHeader(user),
        payload,
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    it('adds photos to a text-only comment', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await postComment(app, post.id, author, { content: 'just words' });

      const photoUrls = [assetPath(), assetPath()];
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { content: 'just words', attachmentUrls: photoUrls },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().attachmentUrls).toEqual(photoUrls);
      expect(res.json().attachmentUrl).toBe(photoUrls[0]);
    });

    it('removes photos from a comment, clearing the legacy mirror too', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await postComment(app, post.id, author, {
        content: 'look at these',
        attachmentUrls: [assetPath(), assetPath()],
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { attachmentUrls: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().attachmentUrls).toEqual([]);
      expect(res.json().attachmentUrl).toBeNull();
      // Untouched: the edit only sent attachments.
      expect(res.json().content).toBe('look at these');
    });

    it('keeps a photo-only comment when the edit drops only one of its photos', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const [keep, drop] = [assetPath(), assetPath()];
      const comment = await postComment(app, post.id, author, { attachmentUrls: [keep, drop] });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { attachmentUrls: [keep] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().attachmentUrls).toEqual([keep]);
      expect(res.json().content).toBe('');
    });

    it('leaves the photos alone when the edit only sends content', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const photoUrls = [assetPath()];
      const comment = await postComment(app, post.id, author, { content: 'before', attachmentUrls: photoUrls });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { content: 'after' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe('after');
      expect(res.json().attachmentUrls).toEqual(photoUrls);
    });

    it('rejects an edit that would leave the comment with neither text nor photos', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await postComment(app, post.id, author, { content: 'something' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { content: '   ', attachmentUrls: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects removing the last photo of a photo-only comment', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await postComment(app, post.id, author, { attachmentUrls: [assetPath()] });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/comments/${comment.id}`,
        headers: authHeader(author),
        payload: { attachmentUrls: [] },
      });

      expect(res.statusCode).toBe(400);
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
