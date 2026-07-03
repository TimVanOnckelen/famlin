import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, createComment, authHeader } from './helpers.js';

describe('likes routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-member liking a post', async () => {
    const author = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${post.id}/like`,
      headers: authHeader(outsider),
    });

    expect(res.statusCode).toBe(403);
  });

  it('toggles a like on a post on and off', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    const first = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) });
    expect(first.json()).toEqual({ myReaction: 'LIKE', counts: { LIKE: 1 } });

    const second = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) });
    expect(second.json()).toEqual({ myReaction: null, counts: {} });
  });

  it('toggles a like on a comment on and off', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });
    const comment = await createComment({ postId: post.id, authorId: author.id });

    const first = await app.inject({ method: 'POST', url: `/api/comments/${comment.id}/like`, headers: authHeader(author) });
    expect(first.json()).toEqual({ myReaction: 'LIKE', counts: { LIKE: 1 } });

    const second = await app.inject({ method: 'POST', url: `/api/comments/${comment.id}/like`, headers: authHeader(author) });
    expect(second.json()).toEqual({ myReaction: null, counts: {} });
  });

  it('rejects liking a comment on a soft-deleted post', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });
    const comment = await createComment({ postId: post.id, authorId: author.id });

    await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

    const res = await app.inject({ method: 'POST', url: `/api/comments/${comment.id}/like`, headers: authHeader(author) });
    expect(res.statusCode).toBe(404);
  });
});

describe('favorites routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-member favoriting a post', async () => {
    const author = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${post.id}/favorite`,
      headers: authHeader(outsider),
    });

    expect(res.statusCode).toBe(403);
  });

  it('toggles a favorite on and off, and lists it under /api/favorites', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    const toggleOn = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/favorite`, headers: authHeader(author) });
    expect(toggleOn.json()).toEqual({ favorited: true });

    const list = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(author) });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].id).toBe(post.id);

    const toggleOff = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/favorite`, headers: authHeader(author) });
    expect(toggleOff.json()).toEqual({ favorited: false });

    const listAfter = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(author) });
    expect(listAfter.json().items).toHaveLength(0);
  });

  it('excludes a favorited post from /api/favorites once it is soft-deleted', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    await app.inject({ method: 'POST', url: `/api/posts/${post.id}/favorite`, headers: authHeader(author) });
    await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

    const list = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(author) });
    expect(list.json().items).toHaveLength(0);
  });

  it('only returns the current user\'s own favorites, never another member\'s', async () => {
    const memberA = await createUser();
    const memberB = await createUser();
    const group = await createGroupWithMember(memberA);
    await addMember(group.id, memberB.id);
    const post = await createPost({ groupId: group.id, authorId: memberA.id });

    await app.inject({ method: 'POST', url: `/api/posts/${post.id}/favorite`, headers: authHeader(memberA) });

    const listB = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(memberB) });
    expect(listB.json().items).toHaveLength(0);
  });
});
