import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroup, authHeader } from './helpers.js';

// Rate-limited routes (register, oidc, login) are hit repeatedly across these
// tests; a fresh app per test gives each one its own in-memory rate-limit
// store instead of sharing one counter across the whole file.
describe('invites routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createInvite(overrides: Partial<{ email: string; expiresAt: Date; usedAt: Date; groupId: string }> = {}) {
    const group = overrides.groupId ? { id: overrides.groupId } : await createGroup();
    return prisma.invite.create({
      data: {
        token: `token-${Math.random().toString(36).slice(2)}`,
        groupId: group.id,
        email: overrides.email,
        expiresAt: overrides.expiresAt,
        usedAt: overrides.usedAt,
      },
    });
  }

  describe('preview', () => {
    it('reports not_found for an unknown token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/invites/does-not-exist' });
      expect(res.json().status).toBe('not_found');
    });

    it('reports valid for a fresh invite', async () => {
      const invite = await createInvite();
      const res = await app.inject({ method: 'GET', url: `/api/invites/${invite.token}` });
      expect(res.json().status).toBe('valid');
    });

    it('reports expired for an expired invite', async () => {
      const invite = await createInvite({ expiresAt: new Date(Date.now() - 1000) });
      const res = await app.inject({ method: 'GET', url: `/api/invites/${invite.token}` });
      expect(res.json().status).toBe('expired');
    });

    it('reports used for an already-consumed invite', async () => {
      const invite = await createInvite({ usedAt: new Date() });
      const res = await app.inject({ method: 'GET', url: `/api/invites/${invite.token}` });
      expect(res.json().status).toBe('used');
    });
  });

  describe('self-service registration bypasses allowedEmails', () => {
    it('lets an invite provision an account for an email that is not on the allowlist', async () => {
      const admin = await createUser({ isAdmin: true });
      await app.inject({
        method: 'PATCH',
        url: '/api/admin/settings',
        headers: authHeader(admin),
        payload: { allowedEmails: ['onlythisone@example.com'] },
      });

      const invite = await createInvite();
      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/register`,
        payload: { name: 'New Person', email: 'not-on-list@example.com', password: 'supersecret123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBeTruthy();

      const created = await prisma.user.findUnique({ where: { email: 'not-on-list@example.com' } });
      expect(created).not.toBeNull();

      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: invite.groupId, userId: created!.id } },
      });
      expect(membership).not.toBeNull();
    });

    it('rejects registration on an expired invite', async () => {
      const invite = await createInvite({ expiresAt: new Date(Date.now() - 1000) });
      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/register`,
        payload: { name: 'Late Person', email: 'late@example.com', password: 'supersecret123' },
      });
      expect(res.statusCode).toBe(410);

      const created = await prisma.user.findUnique({ where: { email: 'late@example.com' } });
      expect(created).toBeNull();
    });

    it('rejects registration on an already-used invite', async () => {
      const invite = await createInvite({ usedAt: new Date() });
      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/register`,
        payload: { name: 'Second Person', email: 'second@example.com', password: 'supersecret123' },
      });
      expect(res.statusCode).toBe(410);
    });

    it('rejects a registration email that does not match an invite pinned to a specific email', async () => {
      const invite = await createInvite({ email: 'reserved@example.com' });
      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/register`,
        payload: { name: 'Wrong Person', email: 'someone-else@example.com', password: 'supersecret123' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects registering with an email that already has an account', async () => {
      const existing = await createUser({ email: 'exists@example.com' });
      const invite = await createInvite();

      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/register`,
        payload: { name: 'Dup', email: existing.email, password: 'supersecret123' },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('accept (authenticated join)', () => {
    it('lets a logged-in user join the invite\'s group', async () => {
      const user = await createUser();
      const invite = await createInvite();

      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/accept`,
        headers: authHeader(user),
      });

      expect(res.statusCode).toBe(200);
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: invite.groupId, userId: user.id } },
      });
      expect(membership).not.toBeNull();
    });

    it('rejects accepting an invite pinned to a different email', async () => {
      const user = await createUser({ email: 'me@example.com' });
      const invite = await createInvite({ email: 'someoneelse@example.com' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/invites/${invite.token}/accept`,
        headers: authHeader(user),
      });

      expect(res.statusCode).toBe(403);
    });

    it('requires authentication', async () => {
      const invite = await createInvite();
      const res = await app.inject({ method: 'POST', url: `/api/invites/${invite.token}/accept` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('admin invite management requires admin', () => {
    it('rejects a non-admin creating an invite', async () => {
      const nonAdmin = await createUser();
      const group = await createGroup();

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/invites`,
        headers: authHeader(nonAdmin),
        payload: {},
      });

      expect(res.statusCode).toBe(403);
      const invites = await prisma.invite.findMany({ where: { groupId: group.id } });
      expect(invites).toHaveLength(0);
    });

    it('lets an admin create an invite', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroup();

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/invites`,
        headers: authHeader(admin),
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().link).toContain('/invite/');
    });
  });
});
