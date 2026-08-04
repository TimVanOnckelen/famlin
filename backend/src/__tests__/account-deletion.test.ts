import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';

// DELETE /api/auth/me — the in-app account deletion path App Store guideline
// 5.1.1(v) requires. Pins that it really is a hard delete (content gone, token
// dead), and that it can't strand the deployment without an admin.

const runId = `${Date.now()}`;
const groupId = `test-group-del-${runId}`;

let app: FastifyInstance;

function tokenFor(user: { id: string; email: string; name: string; isAdmin: boolean; tokenVersion: number }) {
  return createUserToken(user);
}

async function createMember(label: string, isAdmin = false) {
  const user = await prisma.user.create({
    data: { email: `${label}-${runId}@test.local`, name: label, isAdmin },
  });
  await prisma.groupMember.create({ data: { groupId, userId: user.id } });
  return user;
}

beforeAll(async () => {
  app = await buildApp();
  await prisma.group.create({ data: { id: groupId, name: 'Deletion Test Group' } });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: groupId } });
  await prisma.user.deleteMany({ where: { email: { contains: `-${runId}@test.local` } } });
  await app.close();
  await prisma.$disconnect();
});

describe('DELETE /api/auth/me', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('permanently deletes the account, its content, and its sessions', async () => {
    const user = await createMember('self-delete');
    const token = tokenFor(user);

    const post = await prisma.post.create({
      data: { content: 'Goodbye', groupId, authorId: user.id },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    // Cascades, same as an admin-initiated delete — there is no restore.
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect(await prisma.groupMember.count({ where: { userId: user.id } })).toBe(0);

    const afterRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRes.statusCode).toBe(401);
  });

  it('refuses to delete the only remaining admin', async () => {
    // The suite starts against a truncated database (tests/setup/test-setup.ts)
    // and nothing before this creates an admin, so this one really is the last.
    const admin = await createMember('last-admin', true);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();

    await prisma.user.delete({ where: { id: admin.id } });
  });

  it('lets an admin delete themselves when another admin remains', async () => {
    await createMember('kept-admin', true);
    const leaving = await createMember('leaving-admin', true);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${tokenFor(leaving)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: leaving.id } })).toBeNull();
  });
});
