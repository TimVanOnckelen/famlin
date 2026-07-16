import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';

// Exercises the chitchat (per-group chat) API: group-membership + the
// chitchatEnabled gate, message create/list/delete authorization, and the
// read-receipt-derived unread-count endpoint. Runs against the real dev
// database using uniquely-prefixed, self-cleaning fixtures (same pattern as
// authorization.test.ts).

const runId = `${Date.now()}`;

const chitchatGroupId = `test-chat-group-${runId}`;
const disabledGroupId = `test-chat-disabled-group-${runId}`;
const unreadGroupId = `test-chat-unread-group-${runId}`;

let app: FastifyInstance;

let memberA: { id: string; email: string; name: string; tokenVersion: number };
let memberB: { id: string; email: string; name: string; tokenVersion: number };
let memberC: { id: string; email: string; name: string; tokenVersion: number };
let admin: { id: string; email: string; name: string; tokenVersion: number };
let tokenA: string;
let tokenB: string;
let tokenC: string;
let adminToken: string;

function tokenFor(user: { id: string; email: string; name: string; tokenVersion: number }, isAdmin = false) {
  return createUserToken({ id: user.id, email: user.email, name: user.name, isAdmin, tokenVersion: user.tokenVersion });
}

beforeAll(async () => {
  app = await buildApp();

  await prisma.group.createMany({
    data: [
      { id: chitchatGroupId, name: 'Test Chitchat Group', chitchatEnabled: true },
      { id: disabledGroupId, name: 'Test Chitchat-Disabled Group', chitchatEnabled: false },
      { id: unreadGroupId, name: 'Test Unread-Counts Group', chitchatEnabled: true },
    ],
  });

  memberA = await prisma.user.create({ data: { email: `chat-member-a-${runId}@test.local`, name: 'Chat Member A' } });
  memberB = await prisma.user.create({ data: { email: `chat-member-b-${runId}@test.local`, name: 'Chat Member B' } });
  memberC = await prisma.user.create({ data: { email: `chat-member-c-${runId}@test.local`, name: 'Chat Member C (non-member)' } });
  admin = await prisma.user.create({ data: { email: `chat-admin-${runId}@test.local`, name: 'Chat Admin', isAdmin: true } });

  await prisma.groupMember.createMany({
    data: [
      { groupId: chitchatGroupId, userId: memberA.id },
      { groupId: chitchatGroupId, userId: memberB.id },
      { groupId: disabledGroupId, userId: memberA.id },
      { groupId: unreadGroupId, userId: memberA.id },
      { groupId: unreadGroupId, userId: memberB.id },
    ],
  });

  tokenA = tokenFor(memberA);
  tokenB = tokenFor(memberB);
  tokenC = tokenFor(memberC);
  adminToken = tokenFor(admin, true);
});

afterAll(async () => {
  // Deleting the groups cascades their memberships and ChatMessage/ChatRead
  // rows; deleting the users cascades anything left.
  await prisma.group.deleteMany({ where: { id: { in: [chitchatGroupId, disabledGroupId, unreadGroupId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberA.id, memberB.id, memberC.id, admin.id] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('group membership + chitchatEnabled gate', () => {
  it('blocks a non-member from listing messages', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenC}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a non-member from posting a message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenC}` },
      payload: { content: 'should not be allowed' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a member from listing messages when chitchat is disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/groups/${disabledGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks a member from posting a message when chitchat is disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${disabledGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'should not be allowed either' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('creating, listing, and deleting messages', () => {
  it('lets a member create a message and round-trips its shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'hello group' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      groupId: chitchatGroupId,
      authorId: memberA.id,
      author: { id: memberA.id, name: memberA.name },
      kind: 'USER',
      content: 'hello group',
      attachmentUrl: null,
      refPostId: null,
      editedAt: null,
    });
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('createdAt');
    expect(Array.isArray(body.readBy)).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    expect(listBody).toHaveProperty('items');
    expect(listBody).toHaveProperty('nextCursor');
    expect(listBody.items.map((m: { id: string }) => m.id)).toContain(body.id);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/chat/messages/${body.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ success: true });
  });

  it('blocks a non-author, non-admin member from deleting someone else\'s message, but lets an admin', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'a message from member A' },
    });
    expect(create.statusCode).toBe(200);
    const messageId = create.json().id;

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/chat/messages/${messageId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(blocked.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'DELETE',
      url: `/api/chat/messages/${messageId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ success: true });
  });
});

describe('replying to a message', () => {
  it('creates a message replying to another and round-trips the replyTo excerpt', async () => {
    const original = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'original message to reply to' },
    });
    expect(original.statusCode).toBe(200);
    const originalId = original.json().id;

    const reply = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { content: 'a reply', replyToMessageId: originalId },
    });
    expect(reply.statusCode).toBe(200);
    const replyBody = reply.json();
    expect(replyBody.replyToMessageId).toBe(originalId);
    expect(replyBody.replyTo).toMatchObject({
      id: originalId,
      authorId: memberA.id,
      authorName: memberA.name,
      kind: 'USER',
      content: 'original message to reply to',
      attachmentUrl: null,
    });
  });

  it('returns 404 when replyToMessageId does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'replying to nothing', replyToMessageId: `nonexistent-${runId}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it('returns 404 when replyToMessageId points at a message in a different group', async () => {
    const otherGroupMessage = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${unreadGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'a message in a different group' },
    });
    expect(otherGroupMessage.statusCode).toBe(200);
    const otherGroupMessageId = otherGroupMessage.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${chitchatGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'cross-group reply attempt', replyToMessageId: otherGroupMessageId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('read receipts and unread counts', () => {
  it('marks a group read for one member while another member still sees it unread', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${unreadGroupId}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'unread-counts fixture message' },
    });
    expect(create.statusCode).toBe(200);

    const markRead = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${unreadGroupId}/read`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(markRead.statusCode).toBe(200);

    const countsForB = await app.inject({
      method: 'GET',
      url: '/api/chat/unread-counts',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(countsForB.statusCode).toBe(200);
    expect(countsForB.json()[unreadGroupId]).toBe(0);

    const countsForA = await app.inject({
      method: 'GET',
      url: '/api/chat/unread-counts',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(countsForA.statusCode).toBe(200);
    expect(countsForA.json()[unreadGroupId]).toBeGreaterThan(0);
  });
});
