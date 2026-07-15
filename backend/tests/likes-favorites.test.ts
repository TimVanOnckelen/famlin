import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
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

  // Regression for a read-then-write race: two concurrent identical taps
  // (double-tap / client retry) both see "no existing reaction" and both try
  // to create one — without the upsert-based fix, the loser hit the
  // postId_userId unique constraint (P2002) and surfaced as a 500 instead of
  // an idempotent success.
  //
  // The two requests aren't guaranteed to interleave at exactly the same
  // point (that depends on real DB round-trip timing, which varies under
  // load) — a "clean" race (both read null before either writes) always
  // ends with the reaction ON, but a request that reads only after the
  // other's write has landed sees toggle-off semantics fire instead, which
  // is correct, not a bug. So the assertion that actually pins the
  // regression is "never a 500, never a duplicate row" — not one specific
  // final myReaction.
  it('handles a concurrent double-tap like on a post without a 500', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) }),
      app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const rows = await prisma.like.findMany({ where: { postId: post.id, userId: author.id } });
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows.length === 1) expect(rows[0].type).toBe('LIKE');
  });

  // Same race, but on the delete path: two concurrent taps that both see the
  // same existing reaction and both try to remove it — the loser should hit
  // P2025 (already deleted) and still report success rather than a 500.
  it('handles a concurrent double-tap unlike on a post without a 500', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });

    await app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) });

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) }),
      app.inject({ method: 'POST', url: `/api/posts/${post.id}/like`, headers: authHeader(author) }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const rows = await prisma.like.findMany({ where: { postId: post.id, userId: author.id } });
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows.length === 1) expect(rows[0].type).toBe('LIKE');
  });

  it('handles a concurrent double-tap like on a comment without a 500', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const post = await createPost({ groupId: group.id, authorId: author.id });
    const comment = await createComment({ postId: post.id, authorId: author.id });

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/comments/${comment.id}/like`, headers: authHeader(author) }),
      app.inject({ method: 'POST', url: `/api/comments/${comment.id}/like`, headers: authHeader(author) }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const rows = await prisma.like.findMany({ where: { commentId: comment.id, userId: author.id } });
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows.length === 1) expect(rows[0].type).toBe('LIKE');
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
