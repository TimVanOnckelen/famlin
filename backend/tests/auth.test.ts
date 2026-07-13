import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroup, authHeader } from './helpers.js';

// A fresh app per test avoids the /login, /oidc, and /register rate limits
// (10 requests / 15 minutes, keyed by IP) bleeding across unrelated tests —
// every injected request in this environment shares the same source IP.
describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('password login', () => {
    it('logs in with correct credentials', async () => {
      const user = await createUser({ email: 'me@example.com', password: 'correct-password' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'correct-password' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBeTruthy();
      expect(res.json().user.email).toBe(user.email);
    });

    it('rejects the wrong password', async () => {
      const user = await createUser({ email: 'me2@example.com', password: 'correct-password' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'wrong-password' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects login for an unknown email without leaking whether the account exists', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever123' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects login for a deleted user', async () => {
      const user = await createUser({ email: 'gone@example.com', password: 'correct-password' });
      await prisma.user.delete({ where: { id: user.id } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'correct-password' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('session invalidation via tokenVersion', () => {
    it('rejects a token signed before a password change', async () => {
      const user = await createUser({ email: 'change-pw@example.com', password: 'old-password123' });
      const staleHeader = authHeader(user);

      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: staleHeader,
        payload: { currentPassword: 'old-password123', newPassword: 'new-password456' },
      });
      expect(changeRes.statusCode).toBe(200);

      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: staleHeader });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a token signed before an admin password reset', async () => {
      const admin = await createUser({ isAdmin: true });
      const user = await createUser();
      const staleHeader = authHeader(user);

      const resetRes = await app.inject({
        method: 'POST',
        url: `/api/auth/reset-password/${user.id}`,
        headers: authHeader(admin),
        payload: { newPassword: 'admin-set-password' },
      });
      expect(resetRes.statusCode).toBe(200);

      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: staleHeader });
      expect(res.statusCode).toBe(401);
    });

    it('a freshly issued token (post-change) still works', async () => {
      const user = await createUser({ email: 'refresh@example.com', password: 'old-password123' });

      await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: authHeader(user),
        payload: { currentPassword: 'old-password123', newPassword: 'new-password456' },
      });

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'new-password456' },
      });
      const newToken = loginRes.json().token;

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${newToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    // /uploads/* is authorized via isSessionCurrent(), which caches its DB
    // lookup briefly (see plugins/auth.ts) for a hot path hit on every
    // photo/video render. These confirm the explicit cache invalidation on
    // every tokenVersion-changing (or account-deleting) route still makes
    // revocation effectively immediate, rather than only after the cache
    // TTL expires.
    it('revokes an already-issued media token immediately after a password change', async () => {
      const user = await createUser({ email: 'media-pw@example.com', password: 'old-password123' });
      const staleHeader = authHeader(user);

      const tokenRes = await app.inject({ method: 'GET', url: '/api/uploads/media-token', headers: staleHeader });
      const mediaToken = tokenRes.json().token;

      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: staleHeader,
        payload: { currentPassword: 'old-password123', newPassword: 'new-password456' },
      });
      expect(changeRes.statusCode).toBe(200);

      const res = await app.inject({ method: 'GET', url: `/uploads/nonexistent.jpg?token=${mediaToken}` });
      expect(res.statusCode).toBe(401);
    });

    it('revokes an already-issued media token immediately after an admin deletes the account', async () => {
      const admin = await createUser({ isAdmin: true });
      const user = await createUser();
      const userHeader = authHeader(user);

      const tokenRes = await app.inject({ method: 'GET', url: '/api/uploads/media-token', headers: userHeader });
      const mediaToken = tokenRes.json().token;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${user.id}`,
        headers: authHeader(admin),
      });
      expect(deleteRes.statusCode).toBe(200);

      const res = await app.inject({ method: 'GET', url: `/uploads/nonexistent.jpg?token=${mediaToken}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('registration is admin-only', () => {
    it('rejects a non-admin creating a user via /register', async () => {
      const nonAdmin = await createUser();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(nonAdmin),
        payload: { email: 'new@example.com', name: 'New', password: 'password1234' },
      });

      expect(res.statusCode).toBe(403);
      const created = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
      expect(created).toBeNull();
    });

    it('lets an admin create a user', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(admin),
        payload: { email: 'created-by-admin@example.com', name: 'New', password: 'password1234' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('rejects creating a user with an email that already exists', async () => {
      const admin = await createUser({ isAdmin: true });
      const existing = await createUser({ email: 'dup@example.com' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(admin),
        payload: { email: existing.email, name: 'New', password: 'password1234' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('creates memberships for the given groupIds', async () => {
      const admin = await createUser({ isAdmin: true });
      const groupA = await createGroup();
      const groupB = await createGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(admin),
        payload: {
          email: 'with-groups@example.com',
          name: 'New',
          password: 'password1234',
          groupIds: [groupA.id, groupB.id],
        },
      });

      expect(res.statusCode).toBe(200);
      const userId = res.json().user.id;
      const memberships = await prisma.groupMember.findMany({ where: { userId } });
      expect(memberships.map((m) => m.groupId).sort()).toEqual([groupA.id, groupB.id].sort());
    });

    it('rejects an unknown groupId and creates no user', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(admin),
        payload: {
          email: 'bad-group@example.com',
          name: 'New',
          password: 'password1234',
          groupIds: [group.id, 'nonexistent-group-id'],
        },
      });

      expect(res.statusCode).toBe(400);
      const created = await prisma.user.findUnique({ where: { email: 'bad-group@example.com' } });
      expect(created).toBeNull();
    });

    it('creates a user with no memberships when groupIds is omitted', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: authHeader(admin),
        payload: { email: 'no-groups@example.com', name: 'New', password: 'password1234' },
      });

      expect(res.statusCode).toBe(200);
      const userId = res.json().user.id;
      const memberships = await prisma.groupMember.findMany({ where: { userId } });
      expect(memberships).toHaveLength(0);
    });
  });

  describe('OIDC when not configured', () => {
    it('returns disabled config from /oidc-config', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/oidc-config' });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(false);
    });

    it('returns 503 from /oidc when no provider is configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc',
        payload: { idToken: 'irrelevant.jwt.token' },
      });
      expect(res.statusCode).toBe(503);
    });
  });

  describe('unauthenticated access', () => {
    it('rejects /me without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a token with a bad signature', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
