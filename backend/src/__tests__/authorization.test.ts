import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';
import { consumeInvite } from '../services/invites.js';
import { generateInviteToken } from '../services/invites.js';

// Exercises the group-membership authorization matrix and the hard-delete
// regressions found in code review (comments/likes on a deleted post were
// still reachable; a deleted user's token still worked). Runs against
// the real dev database using uniquely-prefixed, self-cleaning fixtures so
// it doesn't collide with seed data.

const runId = `${Date.now()}`;
const groupAId = `test-group-a-${runId}`;
const groupBId = `test-group-b-${runId}`;

let app: FastifyInstance;
let memberA: { id: string; email: string; name: string; tokenVersion: number };
let memberB: { id: string; email: string; name: string; tokenVersion: number };
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();

  await prisma.group.createMany({
    data: [
      { id: groupAId, name: 'Test Group A' },
      { id: groupBId, name: 'Test Group B' },
    ],
  });

  memberA = await prisma.user.create({
    data: { email: `member-a-${runId}@test.local`, name: 'Member A' },
  });
  memberB = await prisma.user.create({
    data: { email: `member-b-${runId}@test.local`, name: 'Member B' },
  });

  await prisma.groupMember.create({ data: { groupId: groupAId, userId: memberA.id } });
  await prisma.groupMember.create({ data: { groupId: groupBId, userId: memberB.id } });

  tokenA = createUserToken({ id: memberA.id, email: memberA.email, name: memberA.name, isAdmin: false, tokenVersion: memberA.tokenVersion });
  tokenB = createUserToken({ id: memberB.id, email: memberB.email, name: memberB.name, isAdmin: false, tokenVersion: memberB.tokenVersion });
});

afterAll(async () => {
  // Deleting the groups cascades their posts/comments/likes/memberships;
  // deleting the users cascades anything left (favorites, notifications).
  await prisma.group.deleteMany({ where: { id: { in: [groupAId, groupBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberA.id, memberB.id] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('group membership authorization', () => {
  it('lets a member list posts in their own group', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupId=${groupAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
  });

  it('blocks a non-member from listing another group\'s posts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupId=${groupAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a non-member from creating a post in another group', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { groupId: groupAId, content: 'should not be allowed' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('multi-group feed filter', () => {
  let postAId: string;
  let postBId: string;

  beforeAll(async () => {
    const postA = await prisma.post.create({
      data: { groupId: groupAId, authorId: memberA.id, content: 'post in group A', uploadedAssetUrls: [] },
    });
    const postB = await prisma.post.create({
      data: { groupId: groupBId, authorId: memberB.id, content: 'post in group B', uploadedAssetUrls: [] },
    });
    postAId = postA.id;
    postBId = postB.id;
  });

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { id: { in: [postAId, postBId] } } });
  });

  it('returns only the caller\'s own groups when no filter is given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/posts',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(postAId);
    expect(ids).not.toContain(postBId);
  });

  it('accepts a groupIds subset the caller belongs to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupIds=${groupAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(postAId);
  });

  it('rejects a groupIds list containing a group the caller is not in', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupIds=${groupAId},${groupBId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns an empty page (not an error) for a user in no groups', async () => {
    const loner = await prisma.user.create({
      data: { email: `loner-${runId}@test.local`, name: 'No Groups' },
    });
    const lonerToken = createUserToken({
      id: loner.id,
      email: loner.email,
      name: loner.name,
      isAdmin: false,
      tokenVersion: loner.tokenVersion,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/posts',
      headers: { authorization: `Bearer ${lonerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
    await prisma.user.delete({ where: { id: loner.id } });
  });
});

describe('deleted post regressions', () => {
  let postId: string;

  beforeAll(async () => {
    const post = await prisma.post.create({
      data: { authorId: memberA.id, groupId: groupAId, content: 'to be deleted' },
    });
    postId = post.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/posts/${postId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(del.statusCode).toBe(200);
  });

  it('404s fetching the deleted post', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s listing comments on the deleted post', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/comments`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s liking the deleted post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/like`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('session invalidation', () => {
  it('rejects a token for a deleted user', async () => {
    const user = await prisma.user.create({
      data: { email: `deleted-${runId}@test.local`, name: 'Deleted' },
    });
    const token = createUserToken({ id: user.id, email: user.email, name: user.name, isAdmin: false, tokenVersion: user.tokenVersion });

    await prisma.user.delete({ where: { id: user.id } });

    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token whose tokenVersion no longer matches the user (e.g. after a password reset)', async () => {
    const user = await prisma.user.create({
      data: { email: `stale-token-${runId}@test.local`, name: 'Stale Token' },
    });
    const staleToken = createUserToken({ id: user.id, email: user.email, name: user.name, isAdmin: false, tokenVersion: user.tokenVersion });

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });

    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${staleToken}` } });
    expect(res.statusCode).toBe(401);

    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe('invite consumption is single-use', () => {
  it('does not join a second, unrelated user once the invite is already claimed', async () => {
    const claimant = await prisma.user.create({ data: { email: `invite-claimant-${runId}@test.local`, name: 'Claimant' } });
    const latecomer = await prisma.user.create({ data: { email: `invite-latecomer-${runId}@test.local`, name: 'Latecomer' } });
    const invite = await prisma.invite.create({
      data: { token: generateInviteToken(), groupId: groupBId },
    });

    await consumeInvite(invite.token, claimant.id);
    await consumeInvite(invite.token, latecomer.id);

    const claimantInGroupB = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: groupBId, userId: claimant.id } },
    });
    const latecomerInGroupB = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: groupBId, userId: latecomer.id } },
    });

    expect(claimantInGroupB).not.toBeNull();
    expect(latecomerInGroupB).toBeNull();

    const updatedInvite = await prisma.invite.findUnique({ where: { id: invite.id } });
    expect(updatedInvite?.usedById).toBe(claimant.id);

    await prisma.invite.delete({ where: { id: invite.id } });
    await prisma.user.deleteMany({ where: { id: { in: [claimant.id, latecomer.id] } } });
  });
});
