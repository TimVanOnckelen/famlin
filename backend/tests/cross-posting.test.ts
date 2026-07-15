import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js';

// Cross-posting fans one write out into one Post row per target group,
// sharing Post.crossPostId — see routes/posts.ts's POST / and CLAUDE.md.
// Privacy rule under test throughout: crossPostId itself must never appear
// in any API response, and `sharedWithGroups` must only ever appear for the
// author's own view of the post.
describe('cross-posting', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates one Post row per target group sharing a crossPostId and identical createdAt', async () => {
    const author = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'hello both families' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty('crossPostId');
    expect(body.sharedWithGroups).toHaveLength(2);
    expect(body.sharedWithGroups).toEqual(
      expect.arrayContaining([
        { id: groupA.id, name: groupA.name },
        { id: groupB.id, name: groupB.name },
      ])
    );

    const rows = await prisma.post.findMany({ where: { content: 'hello both families' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].crossPostId).not.toBeNull();
    expect(rows[0].crossPostId).toBe(rows[1].crossPostId);
    expect(rows[0].createdAt.getTime()).toBe(rows[1].createdAt.getTime());
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([groupA.id, groupB.id]));
  });

  it('rejects a groupIds list containing a group the caller is not a member of, creating zero posts', async () => {
    const author = await createUser();
    const stranger = await createUser();
    const outsiderGroup = await createGroupWithMember(stranger);
    const groupA = await createGroupWithMember(author);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, outsiderGroup.id], content: 'should not be created' },
    });

    expect(res.statusCode).toBe(403);

    const rows = await prisma.post.findMany({ where: { content: 'should not be created' } });
    expect(rows).toHaveLength(0);
  });

  it('still accepts the legacy single-groupId body, unaffected by cross-posting', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'legacy shape' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe('legacy shape');
    expect(res.json().sharedWithGroups).toBeUndefined();

    const row = await prisma.post.findFirst({ where: { content: 'legacy shape' } });
    expect(row?.crossPostId).toBeNull();
  });

  it('keeps comments and likes isolated per sibling', async () => {
    const author = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'isolated' },
    });
    expect(create.statusCode).toBe(200);

    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'isolated' } });
    const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'isolated' } });

    const comment = await app.inject({
      method: 'POST',
      url: `/api/posts/${postA.id}/comments`,
      headers: authHeader(author),
      payload: { content: 'only on A' },
    });
    expect(comment.statusCode).toBe(200);

    const like = await app.inject({ method: 'POST', url: `/api/posts/${postA.id}/like`, headers: authHeader(author) });
    expect(like.statusCode).toBe(200);

    const commentsA = await app.inject({ method: 'GET', url: `/api/posts/${postA.id}/comments`, headers: authHeader(author) });
    const commentsB = await app.inject({ method: 'GET', url: `/api/posts/${postB.id}/comments`, headers: authHeader(author) });
    expect(commentsA.json()).toHaveLength(1);
    expect(commentsB.json()).toHaveLength(0);

    const getA = await app.inject({ method: 'GET', url: `/api/posts/${postA.id}`, headers: authHeader(author) });
    const getB = await app.inject({ method: 'GET', url: `/api/posts/${postB.id}`, headers: authHeader(author) });
    expect(getA.json().likeCount).toBe(1);
    expect(getB.json().likeCount).toBe(0);
  });

  it('dedupes the feed for a member of both target groups, and hides sharedWithGroups/crossPostId from a non-author', async () => {
    const author = await createUser();
    const memberBoth = await createUser();
    const memberBOnly = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);
    await addMember(groupA.id, memberBoth.id);
    await addMember(groupB.id, memberBoth.id);
    await addMember(groupB.id, memberBOnly.id);

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'dedup test' },
    });
    expect(create.statusCode).toBe(200);

    const feedBoth = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(memberBoth) });
    const bothItems = feedBoth.json().items.filter((p: { content: string }) => p.content === 'dedup test');
    expect(bothItems).toHaveLength(1);

    const feedBOnly = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(memberBOnly) });
    const bOnlyItems = feedBOnly.json().items.filter((p: { content: string }) => p.content === 'dedup test');
    expect(bOnlyItems).toHaveLength(1);
    expect(bOnlyItems[0]).not.toHaveProperty('sharedWithGroups');
    expect(JSON.stringify(bOnlyItems[0])).not.toContain('crossPostId');

    const feedAuthor = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) });
    const authorItems = feedAuthor.json().items.filter((p: { content: string }) => p.content === 'dedup test');
    expect(authorItems).toHaveLength(1);
    expect(authorItems[0].sharedWithGroups).toHaveLength(2);
  });

  it('PATCH by the author updates every sibling, and DELETE removes every sibling', async () => {
    const author = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'before edit' },
    });
    const postId = create.json().id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${postId}`,
      headers: authHeader(author),
      payload: { content: 'after edit' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().content).toBe('after edit');
    expect(patch.json().sharedWithGroups).toHaveLength(2);

    const rowsAfterEdit = await prisma.post.findMany({ where: { groupId: { in: [groupA.id, groupB.id] } } });
    expect(rowsAfterEdit).toHaveLength(2);
    expect(rowsAfterEdit.every((r) => r.content === 'after edit')).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/api/posts/${postId}`, headers: authHeader(author) });
    expect(del.statusCode).toBe(200);

    const remaining = await prisma.post.count({ where: { groupId: { in: [groupA.id, groupB.id] } } });
    expect(remaining).toBe(0);
  });

  it('notifies each recipient exactly once even when they belong to every target group', async () => {
    const author = await createUser();
    const recipientBoth = await createUser();
    const recipientAOnly = await createUser();
    const recipientBOnly = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);
    await addMember(groupA.id, recipientBoth.id);
    await addMember(groupB.id, recipientBoth.id);
    await addMember(groupA.id, recipientAOnly.id);
    await addMember(groupB.id, recipientBOnly.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'notify once' },
    });
    expect(res.statusCode).toBe(200);

    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'notify once' } });

    await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { userId: recipientBoth.id, type: 'new_post' } });
      expect(rows).toHaveLength(1);
      // Assigned to the FIRST event-post (groupA's, targets order) whose
      // group they belong to — not notified again for groupB.
      expect(rows[0].relatedPostId).toBe(postA.id);
    });

    const aOnlyRows = await prisma.notification.findMany({ where: { userId: recipientAOnly.id, type: 'new_post' } });
    expect(aOnlyRows).toHaveLength(1);

    const bOnlyRows = await prisma.notification.findMany({ where: { userId: recipientBOnly.id, type: 'new_post' } });
    expect(bOnlyRows).toHaveLength(1);

    const authorRows = await prisma.notification.findMany({ where: { userId: author.id, type: 'new_post' } });
    expect(authorRows).toHaveLength(0);
  });

  // GET /api/posts/search and GET /api/posts/on-this-day are single-group
  // endpoints (?groupId=), and cross-post creation (POST / above) creates at
  // most one Post row per target group, so a crossPostId can never repeat
  // within one group's results today — dedupeByCrossPostId there is
  // defensive. These two pairs of tests cover both the realistic path (a
  // real cross-post, once per group it targets) and, by inserting sibling
  // rows directly, the hypothetical a future change could reintroduce
  // (two rows sharing a crossPostId landing in the SAME group's results).
  it('shows a cross-posted post exactly once in search, for each group it targets', async () => {
    const author = await createUser();
    const memberBoth = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);
    await addMember(groupA.id, memberBoth.id);
    await addMember(groupB.id, memberBoth.id);

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'searchable cross post text' },
    });
    expect(create.statusCode).toBe(200);

    for (const group of [groupA, groupB]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/search?groupId=${group.id}&q=searchable`,
        headers: authHeader(memberBoth),
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items.filter((p: { content: string }) => p.content === 'searchable cross post text');
      expect(items).toHaveLength(1);
    }
  });

  it('dedupes search results if a group ever holds two rows sharing a crossPostId', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const crossPostId = randomUUID();
    const createdAt = new Date();

    await prisma.post.createMany({
      data: [
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling search text', crossPostId, createdAt },
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling search text', crossPostId, createdAt },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/search?groupId=${group.id}&q=duplicate%20sibling`,
      headers: authHeader(author),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it('shows a cross-posted post exactly once in on-this-day, for each group it targets', async () => {
    const author = await createUser();
    const memberBoth = await createUser();
    const groupA = await createGroupWithMember(author);
    const groupB = await createGroupWithMember(author);
    await addMember(groupA.id, memberBoth.id);
    await addMember(groupB.id, memberBoth.id);

    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    const crossPostId = randomUUID();
    await prisma.post.createMany({
      data: [
        { authorId: author.id, groupId: groupA.id, content: 'on this day cross post', crossPostId, createdAt: lastYear },
        { authorId: author.id, groupId: groupB.id, content: 'on this day cross post', crossPostId, createdAt: lastYear },
      ],
    });

    for (const group of [groupA, groupB]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/on-this-day?groupId=${group.id}`,
        headers: authHeader(memberBoth),
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items.filter((p: { content: string }) => p.content === 'on this day cross post');
      expect(items).toHaveLength(1);
    }
  });

  it('dedupes on-this-day results if a group ever holds two rows sharing a crossPostId', async () => {
    const author = await createUser();
    const group = await createGroupWithMember(author);
    const crossPostId = randomUUID();
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    await prisma.post.createMany({
      data: [
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling on this day', crossPostId, createdAt: lastYear },
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling on this day', crossPostId, createdAt: lastYear },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/on-this-day?groupId=${group.id}`,
      headers: authHeader(author),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items.filter((p: { content: string }) => p.content === 'duplicate sibling on this day');
    expect(items).toHaveLength(1);
  });
});
