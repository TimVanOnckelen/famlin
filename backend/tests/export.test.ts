import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import {
  buildTestApp,
  createUser,
  createGroupWithMember,
  createPost,
  createComment,
  authHeader,
} from './helpers.js';

describe('GET /api/admin/export', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/export' });
    expect(res.statusCode).toBe(401);
  });

  it('403s for a non-admin user', async () => {
    const nonAdmin = await createUser();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(nonAdmin),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns a zip stream for an admin', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    // Local file header signature ("PK\x03\x04") that every zip starts with.
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('includes seeded family content in the archive', async () => {
    const admin = await createUser({ isAdmin: true, password: 'super-secret-pw' });
    const group = await createGroupWithMember(admin);
    const post = await createPost({
      groupId: group.id,
      authorId: admin.id,
      content: 'A very distinctive post body for the export test',
    });
    await createComment({ postId: post.id, authorId: admin.id, content: 'A comment' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    });

    expect(res.statusCode).toBe(200);
    // Store-mode zip: JSON entries aren't deflated, so their bytes appear
    // verbatim in the raw archive body — good enough to assert presence
    // without pulling in a zip-reading library.
    const body = res.rawPayload.toString('latin1');

    expect(body).toContain('manifest.json');
    expect(body).toContain('data/users.json');
    expect(body).toContain('data/posts.json');
    expect(body).toContain(admin.email);
    expect(body).toContain('A very distinctive post body for the export test');
  });

  it('never includes password hashes', async () => {
    const admin = await createUser({ isAdmin: true, password: 'super-secret-pw' });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { passwordHash: true },
    });
    expect(stored.passwordHash).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    });

    expect(res.statusCode).toBe(200);
    const body = res.rawPayload.toString('latin1');

    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain(stored.passwordHash as string);
  });
});
