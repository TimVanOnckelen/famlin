import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';

// GET /api/posts?type= — the filter the Photos tab's shared-albums strip uses
// to list a group's ALBUM posts without paging through the whole feed. Uses
// uniquely-prefixed, self-cleaning fixtures like authorization.test.ts.

const runId = `${Date.now()}`;
const groupId = `test-group-types-${runId}`;

let app: FastifyInstance;
let member: { id: string; email: string; name: string; tokenVersion: number };
let token: string;

beforeAll(async () => {
  app = await buildApp();

  await prisma.group.create({ data: { id: groupId, name: 'Test Group Types' } });
  member = await prisma.user.create({
    data: { email: `member-types-${runId}@test.local`, name: 'Member Types' },
  });
  await prisma.groupMember.create({ data: { groupId, userId: member.id } });

  token = createUserToken({
    id: member.id,
    email: member.email,
    name: member.name,
    isAdmin: false,
    tokenVersion: member.tokenVersion,
  });

  await prisma.post.create({
    data: { groupId, authorId: member.id, content: 'A plain update', type: 'UPDATE' },
  });
  await prisma.post.create({
    data: {
      groupId,
      authorId: member.id,
      content: 'Album post',
      type: 'ALBUM',
      typeData: { title: 'Summer at the lake', coverPhotoUrl: null, closedAt: null, closedByUserId: null },
    },
  });
});

afterAll(async () => {
  await prisma.group.delete({ where: { id: groupId } });
  await prisma.user.delete({ where: { id: member.id } });
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/posts?type=', () => {
  it('returns every type when no filter is given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupIds=${groupId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const types = res.json().items.map((p: { type: string }) => p.type);
    expect(types).toContain('UPDATE');
    expect(types).toContain('ALBUM');
  });

  it('narrows the list to the requested type, enriched as usual', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupIds=${groupId}&type=ALBUM`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('ALBUM');
    // The album enrichment every list endpoint attaches must survive the
    // filter — the strip renders straight from it.
    expect(items[0].album.title).toBe('Summer at the lake');
  });

  it('rejects a type that no handler is registered for', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts?groupIds=${groupId}&type=NOPE`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
