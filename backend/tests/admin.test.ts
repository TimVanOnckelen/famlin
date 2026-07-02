import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, createComment, authHeader } from './helpers.js';

describe('admin routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // requireAdmin() sends the 403 itself and returns true; every handler must
  // `return` on that signal or it keeps running the mutation after denying
  // the response. These regression tests check the actual database state,
  // not just the HTTP status, so they'd catch a handler that forgot to
  // `return`.
  describe('requireAdmin enforcement (status AND no side effect)', () => {
    it('PATCH /users/:id: non-admin gets 403 and the user is left unchanged', async () => {
      const nonAdmin = await createUser();
      const target = await createUser({ name: 'Original Name' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(nonAdmin),
        payload: { isAdmin: true },
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.isAdmin).toBe(false);
    });

    it('DELETE /users/:id: non-admin gets 403 and the user is not deactivated', async () => {
      const nonAdmin = await createUser();
      const target = await createUser();

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(nonAdmin),
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.deletedAt).toBeNull();
    });

    it('DELETE /groups/:id: non-admin gets 403 and the group still exists', async () => {
      const nonAdmin = await createUser();
      const group = await createGroupWithMember(nonAdmin);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/groups/${group.id}`,
        headers: authHeader(nonAdmin),
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.group.findUnique({ where: { id: group.id } });
      expect(stored).not.toBeNull();
    });

    it('POST /groups/:id/members: non-admin gets 403 and the membership is not created', async () => {
      const nonAdmin = await createUser();
      const group = await createGroupWithMember(nonAdmin);
      const target = await createUser();

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/members`,
        headers: authHeader(nonAdmin),
        payload: { userId: target.id },
      });
      expect(res.statusCode).toBe(403);

      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: target.id } },
      });
      expect(membership).toBeNull();
    });

    it('PATCH /settings: non-admin gets 403 and settings are unchanged', async () => {
      const nonAdmin = await createUser();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/settings',
        headers: authHeader(nonAdmin),
        payload: { oidcName: 'Hijacked' },
      });
      expect(res.statusCode).toBe(403);

      const setting = await prisma.setting.findUnique({ where: { key: 'oidcName' } });
      expect(setting).toBeNull();
    });

    it('POST /content/posts/:id/restore: non-admin gets 403 and the post stays deleted', async () => {
      const nonAdmin = await createUser();
      const group = await createGroupWithMember(nonAdmin);
      const post = await createPost({ groupId: group.id, authorId: nonAdmin.id });
      await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/content/posts/${post.id}/restore`,
        headers: authHeader(nonAdmin),
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(stored.deletedAt).not.toBeNull();
    });
  });

  describe('user management', () => {
    it('lets an admin promote a user to admin', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(admin),
        payload: { isAdmin: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().isAdmin).toBe(true);
    });

    it('soft-deletes a user on DELETE and bumps tokenVersion instead of removing the row', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser({ tokenVersion: 0 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.deletedAt).not.toBeNull();
      expect(stored.tokenVersion).toBe(1);
    });

    it('a deactivated user\'s existing session token is rejected after deletion', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser();
      const staleHeader = authHeader(target); // signed with tokenVersion 0, before deactivation

      await app.inject({ method: 'DELETE', url: `/api/admin/users/${target.id}`, headers: authHeader(admin) });

      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: staleHeader });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an admin deleting themselves', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${admin.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects demoting the last remaining admin', async () => {
      const soleAdmin = await createUser({ isAdmin: true });
      // The "last admin" guard counts every active admin in the database, so
      // this test needs to be the only one — clear out any other admins left
      // behind by earlier tests in this file (truncation only runs once per
      // file, not between every test; see tests/setup/test-setup.ts).
      await prisma.user.updateMany({ where: { isAdmin: true, id: { not: soleAdmin.id } }, data: { isAdmin: false } });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${soleAdmin.id}`,
        headers: authHeader(soleAdmin),
        payload: { isAdmin: false },
      });
      expect(res.statusCode).toBe(400);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: soleAdmin.id } });
      expect(stored.isAdmin).toBe(true);
    });

    it('lets an admin deactivate a fellow admin when a second admin remains', async () => {
      const callingAdmin = await createUser({ isAdmin: true });
      const targetAdmin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${targetAdmin.id}`,
        headers: authHeader(callingAdmin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: targetAdmin.id } });
      expect(stored.deletedAt).not.toBeNull();
    });

    it('restores a deactivated user', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser();
      await prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${target.id}/restore`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deletedAt).toBeNull();
    });

    it('excludes deactivated users from the default user list', async () => {
      const admin = await createUser({ isAdmin: true });
      const deactivated = await createUser();
      await prisma.user.update({ where: { id: deactivated.id }, data: { deletedAt: new Date() } });

      const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: authHeader(admin) });
      const ids = res.json().items.map((u: { id: string }) => u.id);
      expect(ids).not.toContain(deactivated.id);
    });
  });

  describe('group membership management', () => {
    it('adds and removes a member from a group', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const target = await createUser();

      const add = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/members`,
        headers: authHeader(admin),
        payload: { userId: target.id },
      });
      expect(add.statusCode).toBe(200);

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/admin/groups/${group.id}/members/${target.id}`,
        headers: authHeader(admin),
      });
      expect(remove.statusCode).toBe(200);

      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: target.id } },
      });
      expect(membership).toBeNull();
    });

    it('removing a member keeps their existing posts visible to remaining members', async () => {
      const admin = await createUser({ isAdmin: true });
      const remaining = await createUser();
      const group = await createGroupWithMember(admin);
      await addMember(group.id, remaining.id);
      const leaving = await createUser();
      await addMember(group.id, leaving.id);
      const post = await createPost({ groupId: group.id, authorId: leaving.id, content: 'from the departed member' });

      await app.inject({
        method: 'DELETE',
        url: `/api/admin/groups/${group.id}/members/${leaving.id}`,
        headers: authHeader(admin),
      });

      const list = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(remaining),
      });
      const ids = list.json().items.map((p: { id: string }) => p.id);
      expect(ids).toContain(post.id);
    });
  });

  describe('content moderation', () => {
    it('restores a soft-deleted post', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/content/posts/${post.id}/restore`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deletedAt).toBeNull();

      const list = await app.inject({
        method: 'GET',
        url: `/api/posts?groupId=${group.id}`,
        headers: authHeader(author),
      });
      expect(list.json().items.map((p: { id: string }) => p.id)).toContain(post.id);
    });

    it('restores a soft-deleted comment', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await createComment({ postId: post.id, authorId: author.id });
      await app.inject({ method: 'DELETE', url: `/api/comments/${comment.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/content/comments/${comment.id}/restore`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deletedAt).toBeNull();
    });

    it('lets an admin see soft-deleted posts across groups they are not a member of via includeDeleted', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author); // admin is NOT a member
      const post = await createPost({ groupId: group.id, authorId: author.id });
      await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/content/posts?includeDeleted=true',
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.map((p: { id: string }) => p.id)).toContain(post.id);
    });
  });
});
