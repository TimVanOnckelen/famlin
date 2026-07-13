import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { __registerMediaProviderForTests, __unregisterMediaProviderForTests } from '../src/services/media/registry.js';
import type { MediaProvider } from '../src/services/media/types.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, createComment, authHeader } from './helpers.js';

// Minimal fake provider (mirrors media-people.test.ts/person-tags.test.ts's
// makeFakeProvider) — only the methods each admin people-catalog test
// actually needs are overridden.
function makeFakeProvider(id: string, overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    id,
    async isConfigured() {
      return true;
    },
    isValidAlbumId() {
      return true;
    },
    async listAlbums() {
      return [];
    },
    async getAlbumInfo() {
      return { assetCount: 0 };
    },
    async listAlbumAssets() {
      return [];
    },
    async isAssetInAlbum() {
      return true;
    },
    async streamAsset() {
      // unused by these tests
    },
    async readAsset() {
      throw new Error('unused by these tests');
    },
    ...overrides,
  };
}

describe('admin routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    __unregisterMediaProviderForTests('fake-admin-people-provider');
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

    it('DELETE /users/:id: non-admin gets 403 and the user is not deleted', async () => {
      const nonAdmin = await createUser();
      const target = await createUser();

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(nonAdmin),
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.user.findUnique({ where: { id: target.id } });
      expect(stored).not.toBeNull();
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

    it('permanently removes the user row on DELETE', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser({ tokenVersion: 0 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${target.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.user.findUnique({ where: { id: target.id } });
      expect(stored).toBeNull();
    });

    it('a deleted user\'s existing session token is rejected', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser();
      const staleHeader = authHeader(target); // signed with tokenVersion 0, before deletion

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

    it('lets an admin delete a fellow admin when a second admin remains', async () => {
      const callingAdmin = await createUser({ isAdmin: true });
      const targetAdmin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${targetAdmin.id}`,
        headers: authHeader(callingAdmin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.user.findUnique({ where: { id: targetAdmin.id } });
      expect(stored).toBeNull();
    });

    it('deleting a user removes them from the user list', async () => {
      const admin = await createUser({ isAdmin: true });
      const target = await createUser();
      await app.inject({ method: 'DELETE', url: `/api/admin/users/${target.id}`, headers: authHeader(admin) });

      const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: authHeader(admin) });
      const ids = res.json().items.map((u: { id: string }) => u.id);
      expect(ids).not.toContain(target.id);
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
    it('permanently deletes a post', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers: authHeader(author) });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.post.findUnique({ where: { id: post.id } });
      expect(stored).toBeNull();
    });

    it('permanently deletes a comment', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, admin.id);
      const post = await createPost({ groupId: group.id, authorId: author.id });
      const comment = await createComment({ postId: post.id, authorId: author.id });

      const res = await app.inject({ method: 'DELETE', url: `/api/comments/${comment.id}`, headers: authHeader(author) });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.comment.findUnique({ where: { id: comment.id } });
      expect(stored).toBeNull();
    });

    it('lets an admin see posts across groups they are not a member of', async () => {
      const admin = await createUser({ isAdmin: true });
      const author = await createUser();
      const group = await createGroupWithMember(author); // admin is NOT a member
      const post = await createPost({ groupId: group.id, authorId: author.id });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/content/posts',
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.map((p: { id: string }) => p.id)).toContain(post.id);
    });
  });

  describe('media album new-asset mode', () => {
    it('rejects a non-admin and leaves the link unchanged', async () => {
      const nonAdmin = await createUser();
      const group = await createGroupWithMember(nonAdmin);
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'nam-a', albumName: 'A' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/media-albums/${link.id}`,
        headers: authHeader(nonAdmin),
        payload: { newAssetMode: 'AUTO' },
      });
      expect(res.statusCode).toBe(403);

      const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
      expect(stored?.newAssetMode).toBe('OFF');
    });

    it('lets an admin set the new-asset mode', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'nam-b', albumName: 'B' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/media-albums/${link.id}`,
        headers: authHeader(admin),
        payload: { newAssetMode: 'MANUAL' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().newAssetMode).toBe('MANUAL');

      const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
      expect(stored?.newAssetMode).toBe('MANUAL');
    });

    it('rejects an invalid mode value', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'nam-c', albumName: 'C' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/media-albums/${link.id}`,
        headers: authHeader(admin),
        payload: { newAssetMode: 'NOPE' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for a nonexistent link', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/media-albums/does-not-exist',
        headers: authHeader(admin),
        payload: { newAssetMode: 'AUTO' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('media person links', () => {
    it('rejects a non-admin listing or creating people-links', async () => {
      const nonAdmin = await createUser();

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/admin/media/people-links',
        headers: authHeader(nonAdmin),
      });
      expect(listRes.statusCode).toBe(403);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/media/people-links',
        headers: authHeader(nonAdmin),
        payload: { provider: 'immich', externalPersonId: 'p1', label: 'Grandpa' },
      });
      expect(createRes.statusCode).toBe(403);

      expect(await prisma.mediaPersonLink.count()).toBe(0);
    });

    it('creates a people-link and lists it with the mapped user', async () => {
      const admin = await createUser({ isAdmin: true });
      const mappedUser = await createUser({ name: 'Grandpa Joe' });

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/media/people-links',
        headers: authHeader(admin),
        payload: { provider: 'immich', externalPersonId: 'person-1', label: 'Grandpa', userId: mappedUser.id },
      });
      expect(createRes.statusCode).toBe(200);
      const created = createRes.json();
      expect(created.label).toBe('Grandpa');
      expect(created.user).toMatchObject({ id: mappedUser.id, name: 'Grandpa Joe' });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/admin/media/people-links',
        headers: authHeader(admin),
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().map((p: { id: string }) => p.id)).toContain(created.id);
    });

    it('upserts on the (provider, externalPersonId) pair instead of erroring', async () => {
      const admin = await createUser({ isAdmin: true });
      const userA = await createUser({ name: 'A' });
      const userB = await createUser({ name: 'B' });

      const first = await app.inject({
        method: 'POST',
        url: '/api/admin/media/people-links',
        headers: authHeader(admin),
        payload: { provider: 'immich', externalPersonId: 'dup-person', label: 'First', userId: userA.id },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/api/admin/media/people-links',
        headers: authHeader(admin),
        payload: { provider: 'immich', externalPersonId: 'dup-person', label: 'Renamed', userId: userB.id },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
      expect(second.json().label).toBe('Renamed');
      expect(second.json().user.id).toBe(userB.id);

      expect(
        await prisma.mediaPersonLink.count({ where: { provider: 'immich', externalPersonId: 'dup-person' } })
      ).toBe(1);
    });

    it('rejects a userId that does not exist', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/media/people-links',
        headers: authHeader(admin),
        payload: { provider: 'immich', externalPersonId: 'ghost-person', label: 'Ghost', userId: 'does-not-exist' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('deletes a people-link, 404s for a nonexistent one', async () => {
      const admin = await createUser({ isAdmin: true });
      const created = await prisma.mediaPersonLink.create({
        data: { provider: 'immich', externalPersonId: 'to-delete', label: 'Bye' },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/media/people-links/${created.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      expect(await prisma.mediaPersonLink.findUnique({ where: { id: created.id } })).toBeNull();

      const missingRes = await app.inject({
        method: 'DELETE',
        url: `/api/admin/media/people-links/${created.id}`,
        headers: authHeader(admin),
      });
      expect(missingRes.statusCode).toBe(404);
    });

    it('400s /media/:provider/people for a provider without the capability (local)', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/media/local/people',
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s /media/:provider/people for an unregistered provider', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/media/nope/people',
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(404);
    });

    it('/media/:provider/people includes people discovered only via getAlbumAssetPeople, deduped against the own-library catalog', async () => {
      const FAKE_PROVIDER_ID = 'fake-admin-people-provider';
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-1', albumName: 'Album 1' },
      });
      // A second linked album on the same provider, to prove discovery
      // aggregates across every linked album, not just the first.
      await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-2', albumName: 'Album 2' },
      });

      let thumbnailCalls = 0;
      __registerMediaProviderForTests(
        makeFakeProvider(FAKE_PROVIDER_ID, {
          async listPeople() {
            return [{ id: 'own-person', name: 'Own Library Person', thumbnailDataUri: 'data:image/jpeg;base64,own' }];
          },
          async getAlbumAssetPeople(externalAlbumId: string) {
            if (externalAlbumId === 'album-1') {
              return new Map([
                ['asset-1', [{ id: 'own-person', name: 'Own Library Person' }]], // already in listPeople() — must not duplicate
                ['asset-2', [{ id: 'cross-owner-person', name: 'Cross Owner Person' }]],
              ]);
            }
            return new Map([['asset-3', [{ id: 'cross-owner-person', name: 'Cross Owner Person' }]]]); // same person, second album — still one entry
          },
          async getPersonThumbnail(externalPersonId: string) {
            thumbnailCalls += 1;
            return externalPersonId === 'cross-owner-person' ? 'data:image/jpeg;base64,cross' : null;
          },
        })
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/media/${FAKE_PROVIDER_ID}/people`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);
      const people = res.json() as Array<{ id: string; name: string; thumbnailDataUri: string | null }>;
      expect(people.map((p) => p.id).sort()).toEqual(['cross-owner-person', 'own-person']);
      expect(people.find((p) => p.id === 'own-person')).toMatchObject({
        name: 'Own Library Person',
        thumbnailDataUri: 'data:image/jpeg;base64,own',
      });
      expect(people.find((p) => p.id === 'cross-owner-person')).toMatchObject({
        name: 'Cross Owner Person',
        thumbnailDataUri: 'data:image/jpeg;base64,cross',
      });
      // Only the genuinely new person needs a thumbnail backfill — once, not
      // once per album it turns up in.
      expect(thumbnailCalls).toBe(1);
    });
  });
});
