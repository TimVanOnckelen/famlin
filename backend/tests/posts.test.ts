import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, authHeader } from './helpers.js';

describe('posts routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('group membership isolation', () => {
    it('rejects listing posts for a group the caller is not a member of', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(outsider),
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects reading a single post from a group the caller is not a member of', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);
      const post = await createPost({ groupId: group.id, authorId: member.id });

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}`,
        headers: authHeader(outsider),
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects creating a post in a group the caller is not a member of', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(outsider),
        payload: { groupId: group.id, content: 'sneaky' },
      });

      expect(res.statusCode).toBe(403);

      const posts = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(member),
      });
      expect(posts.json().items).toHaveLength(0);
    });

    it('lets a member create and then list their post', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const create = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(member),
        payload: { groupId: group.id, content: 'hello family' },
      });
      expect(create.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(member),
      });
      expect(list.json().items).toHaveLength(1);
      expect(list.json().items[0].content).toBe('hello family');
    });
  });

  describe('authorization on mutation', () => {
    it('rejects a non-author, non-admin editing another member\'s post', async () => {
      const author = await createUser();
      const otherMember = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, otherMember.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/posts/${post.id}`,
        headers: authHeader(otherMember),
        payload: { content: 'hijacked' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects a non-author, non-admin deleting another member\'s post', async () => {
      const author = await createUser();
      const otherMember = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, otherMember.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/posts/${post.id}`,
        headers: authHeader(otherMember),
      });

      expect(res.statusCode).toBe(403);
    });

    it('lets an admin delete any member\'s post even without group membership shown elsewhere', async () => {
      const author = await createUser();
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/posts/${post.id}`,
        headers: authHeader(admin),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('soft delete', () => {
    it('excludes soft-deleted posts from the group listing', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/posts/${post.id}`,
        headers: authHeader(author),
      });
      expect(del.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(author),
      });
      expect(list.json().items).toHaveLength(0);
    });

    it('returns 404 for a soft-deleted post fetched directly', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/${post.id}`,
        headers: authHeader(author),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 rather than reviving a soft-deleted post via PATCH', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/posts/${post.id}`,
        headers: authHeader(author),
        payload: { content: 'should not work' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
