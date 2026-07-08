import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';

// Developer personal access tokens: creation (session-only), use as a bearer
// credential with the normal group-membership authorization, and revocation.

const runId = `${Date.now()}`;
const groupId = `test-pat-group-${runId}`;
const otherGroupId = `test-pat-other-group-${runId}`;

let app: FastifyInstance;
let member: { id: string; email: string; name: string; tokenVersion: number };
let outsider: { id: string; email: string; name: string; tokenVersion: number };
let sessionToken: string;
let outsiderSessionToken: string;

async function createPat(session: string, payload: Record<string, unknown> = { name: 'test token' }) {
  return app.inject({
    method: 'POST',
    url: '/api/api-tokens',
    headers: { authorization: `Bearer ${session}` },
    payload,
  });
}

beforeAll(async () => {
  app = await buildApp();

  await prisma.group.createMany({
    data: [
      { id: groupId, name: 'PAT Test Group' },
      { id: otherGroupId, name: 'PAT Other Group' },
    ],
  });

  member = await prisma.user.create({
    data: { email: `pat-member-${runId}@test.local`, name: 'PAT Member' },
  });
  outsider = await prisma.user.create({
    data: { email: `pat-outsider-${runId}@test.local`, name: 'PAT Outsider' },
  });

  await prisma.groupMember.create({ data: { groupId, userId: member.id } });
  await prisma.groupMember.create({ data: { groupId: otherGroupId, userId: outsider.id } });

  sessionToken = createUserToken({ id: member.id, email: member.email, name: member.name, isAdmin: false, tokenVersion: member.tokenVersion });
  outsiderSessionToken = createUserToken({ id: outsider.id, email: outsider.email, name: outsider.name, isAdmin: false, tokenVersion: outsider.tokenVersion });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: { in: [groupId, otherGroupId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [member.id, outsider.id] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('creating API tokens', () => {
  it('returns the plaintext secret exactly once and never stores it', async () => {
    const res = await createPat(sessionToken);
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.token).toMatch(/^famlin_pat_/);
    expect(body.tokenPreview).toBe(body.token.replace('famlin_pat_', '').slice(0, 8));

    // Neither the list response nor the DB row contains the secret.
    const list = await app.inject({
      method: 'GET',
      url: '/api/api-tokens',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(JSON.stringify(list.json())).not.toContain(body.token);

    const row = await prisma.apiToken.findUnique({ where: { id: body.id } });
    expect(row?.tokenHash).not.toBe(body.token);
  });

  it('rejects creation authenticated with another API token', async () => {
    const created = await createPat(sessionToken, { name: 'bootstrap' });
    const pat = created.json().token as string;

    const res = await createPat(pat, { name: 'escalation attempt' });
    expect(res.statusCode).toBe(403);
  });
});

describe('using API tokens', () => {
  it('authenticates like the owning user, including group scoping', async () => {
    const created = await createPat(sessionToken);
    const pat = created.json().token as string;

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(member.id);

    const ownGroup = await app.inject({
      method: 'GET',
      url: `/api/posts?groupId=${groupId}`,
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(ownGroup.statusCode).toBe(200);

    const foreignGroup = await app.inject({
      method: 'GET',
      url: `/api/posts?groupId=${otherGroupId}`,
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(foreignGroup.statusCode).toBe(403);
  });

  it('rejects an unknown or expired token', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer famlin_pat_definitely-not-a-real-token' },
    });
    expect(unknown.statusCode).toBe(401);

    const created = await createPat(sessionToken, { name: 'expiring', expiresInDays: 1 });
    const { id, token } = created.json();
    await prisma.apiToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(expired.statusCode).toBe(401);
  });
});

describe('revoking API tokens', () => {
  it('stops the token working immediately', async () => {
    const created = await createPat(sessionToken, { name: 'to revoke' });
    const { id, token } = created.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${id}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("404s on another user's token without revoking it", async () => {
    const created = await createPat(sessionToken, { name: 'not yours' });
    const { id, token } = created.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/api-tokens/${id}`,
      headers: { authorization: `Bearer ${outsiderSessionToken}` },
    });
    expect(del.statusCode).toBe(404);

    const stillWorks = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillWorks.statusCode).toBe(200);
  });
});
