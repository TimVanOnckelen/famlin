import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { emitDomainEvent, onDomainEvent } from '../src/events.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js';

// Regression tests for the domain-event seam: routes emit facts, the
// notifications subscriber (src/subscribers/notifications.ts) turns them into
// Notification rows. These pin the promise every subscriber relies on — a
// throwing handler never fails the emitting request — and that the
// event->notification wiring produces the same rows the routes used to
// produce directly.
describe('domain events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a throwing handler does not break emit or the other handlers', async () => {
    let ran = false;
    onDomainEvent('reaction.added', () => {
      throw new Error('boom');
    });
    onDomainEvent('reaction.added', () => {
      ran = true;
    });

    expect(() =>
      emitDomainEvent('reaction.added', {
        targetKind: 'post',
        postId: 'p1',
        commentId: null,
        groupId: 'g1',
        groupName: 'G',
        targetAuthorId: 'u1',
        targetContent: null,
        reactorId: 'u2',
        reactorName: 'U2',
        reactionType: 'LIKE',
      })
    ).not.toThrow();

    await vi.waitFor(() => expect(ran).toBe(true));
  });

  it('creating a post notifies the other group members (and not the author)', async () => {
    const author = await createUser();
    const other = await createUser();
    const group = await createGroupWithMember(author);
    await addMember(group.id, other.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'hello family' },
    });
    expect(res.statusCode).toBe(200);

    // The subscriber runs detached from the request — wait for its effect.
    await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { userId: other.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('new_post');
      expect(rows[0].relatedPostId).toBe(res.json().id);
    });

    const authorRows = await prisma.notification.findMany({ where: { userId: author.id } });
    expect(authorRows).toHaveLength(0);
  });

  it('a mentioned member gets a mention notification instead of new_comment, and non-members are dropped', async () => {
    const author = await createUser();
    const commenter = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(author);
    await addMember(group.id, commenter.id);

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'post' },
    });
    const postId = postRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/comments`,
      headers: authHeader(commenter),
      // The outsider id must be re-validated against current group
      // membership by the subscriber and dropped.
      payload: { content: 'hi @author', mentionedUserIds: [author.id, outsider.id] },
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { userId: author.id, relatedPostId: postId } });
      // Exactly one: the mention replaces the generic new_comment so the
      // author isn't double-notified.
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('mention');
    });

    const outsiderRows = await prisma.notification.findMany({ where: { userId: outsider.id } });
    expect(outsiderRows).toHaveLength(0);
  });

  it('a reaction notifies the target author', async () => {
    const author = await createUser();
    const reactor = await createUser();
    const group = await createGroupWithMember(author);
    await addMember(group.id, reactor.id);

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'react to me' },
    });
    const postId = postRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/like`,
      headers: authHeader(reactor),
      payload: { type: 'LOVE' },
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { userId: author.id, type: 'new_like_post' } });
      expect(rows).toHaveLength(1);
    });
  });
});
