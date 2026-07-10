import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { __registerMediaProviderForTests, __unregisterMediaProviderForTests } from '../src/services/media/registry.js';
import type { MediaProvider } from '../src/services/media/types.js';
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js';

// A minimal fake provider registered only for this file, so the person-filter
// intersection logic (routes/media.ts's ?personId=) can be exercised without
// depending on a real Immich server — it's the only provider that implements
// listPeople/getPersonAssetIds in production.
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
    ...overrides,
  };
}

describe('member-facing media people endpoints', () => {
  let app: FastifyInstance;
  const FAKE_PROVIDER_ID = 'fake-people-provider';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    __unregisterMediaProviderForTests(FAKE_PROVIDER_ID);
  });

  describe('GET /api/media/people', () => {
    it('requires groupId', async () => {
      const member = await createUser();

      const res = await app.inject({ method: 'GET', url: '/api/media/people', headers: authHeader(member) });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a non-member of the group', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/people?groupId=${group.id}`,
        headers: authHeader(outsider),
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns an empty array for a group with no linked albums', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/people?groupId=${group.id}`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns mapped people for every provider the group has a linked album on', async () => {
      const member = await createUser();
      const mappedUser = await createUser({ name: 'Aunt May' });
      const group = await createGroupWithMember(member);
      await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'gp-people', albumName: 'Album' },
      });
      const personLink = await prisma.mediaPersonLink.create({
        data: { provider: 'local', externalPersonId: 'ext-1', label: 'Aunt May', userId: mappedUser.id },
      });
      // A person mapped under a provider this group has no linked album on
      // must not show up.
      await prisma.mediaPersonLink.create({
        data: { provider: 'immich', externalPersonId: 'ext-2', label: 'Unrelated' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/people?groupId=${group.id}`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: personLink.externalPersonId, provider: 'local', label: 'Aunt May', userId: mappedUser.id },
      ]);
    });
  });

  describe('GET /api/media/albums/:linkId/assets?personId=', () => {
    it('404s for a personId with no MediaPersonLink mapping', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'unmapped-album', albumName: 'Album' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/albums/${link.id}/assets?personId=never-mapped`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(404);
    });

    it('400s when the mapped provider does not implement person filtering (local)', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: 'local', externalAlbumId: 'no-capability', albumName: 'Album' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: 'local', externalPersonId: 'ext-3', label: 'Someone' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/albums/${link.id}/assets?personId=ext-3`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(400);
    });

    it('intersects the album assets with the person filter provider result', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const allAssets = [
        { id: 'asset-a', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
        { id: 'asset-b', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
        { id: 'asset-c', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
      ];
      __registerMediaProviderForTests(
        makeFakeProvider(FAKE_PROVIDER_ID, {
          async listAlbumAssets() {
            return allAssets;
          },
          async getPersonAssetIds() {
            return new Set(['asset-b']);
          },
        })
      );

      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'fake-album', albumName: 'Fake' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-b', label: 'B Person' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/albums/${link.id}/assets?personId=person-b`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ assetId: string }>;
      expect(body.map((a) => a.assetId)).toEqual(['asset-b']);
    });

    it('uses getAlbumAssetPeople (asset-centric) when the provider implements it, ignoring getPersonAssetIds', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const allAssets = [
        { id: 'asset-a', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
        { id: 'asset-b', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
      ];
      let personAssetIdsCalls = 0;
      __registerMediaProviderForTests(
        makeFakeProvider(FAKE_PROVIDER_ID, {
          async listAlbumAssets() {
            return allAssets;
          },
          // Would give the wrong answer if used — proves the asset-centric
          // path takes priority when both are implemented.
          async getPersonAssetIds() {
            personAssetIdsCalls += 1;
            return new Set(['asset-a']);
          },
          async getAlbumAssetPeople() {
            return new Map([['asset-b', [{ id: 'person-b-2', name: 'B Person' }]]]);
          },
        })
      );

      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'fake-album-2', albumName: 'Fake' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-b-2', label: 'B Person' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/albums/${link.id}/assets?personId=person-b-2`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ assetId: string }>;
      expect(body.map((a) => a.assetId)).toEqual(['asset-b']);
      expect(personAssetIdsCalls).toBe(0);
    });

    it('is label-aware: filtering by one mapped person also matches assets tagged under another MediaPersonLink sharing the same provider + label', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const allAssets = [
        { id: 'asset-a', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
        { id: 'asset-b', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
        { id: 'asset-c', type: 'IMAGE' as const, width: 10, height: 10, originalExt: 'jpg' },
      ];
      __registerMediaProviderForTests(
        makeFakeProvider(FAKE_PROVIDER_ID, {
          async listAlbumAssets() {
            return allAssets;
          },
          async getAlbumAssetPeople() {
            // Two distinct provider-side person ids — e.g. "Emma" recognized
            // separately in two different libraries within one shared album.
            return new Map([
              ['asset-a', [{ id: 'emma-lib-a', name: 'Emma' }]],
              ['asset-b', [{ id: 'emma-lib-b', name: 'Emma' }]],
              ['asset-c', [{ id: 'someone-else', name: 'Not Emma' }]],
            ]);
          },
        })
      );

      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'fake-album-label', albumName: 'Fake' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'emma-lib-a', label: 'Emma' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'emma-lib-b', label: 'Emma' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/albums/${link.id}/assets?personId=emma-lib-a`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ assetId: string }>;
      expect(body.map((a) => a.assetId).sort()).toEqual(['asset-a', 'asset-b']);
    });
  });
});
