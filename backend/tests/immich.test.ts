import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../src/db.js';
import { updateSettings } from '../src/services/settings.js';
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js';

import { immichProvider } from '../src/services/media/immich.js';

// The provider's album/asset lookups talk to a real Immich server over fetch
// — spied here so these tests exercise route/authorization logic (admin
// guard, group membership, cross-group isolation) rather than a live Immich
// instance. isAssetInAlbum is spied too — see the dedicated 'asset proxy
// authorization' tests below for what's actually covered. streamAsset is NOT
// spied: the range-forwarding test mocks global fetch instead to exercise the
// real proxy.
const getAlbumInfoMock = vi.spyOn(immichProvider, 'getAlbumInfo');
const listAlbumAssetsMock = vi.spyOn(immichProvider, 'listAlbumAssets');
const isAssetInAlbumMock = vi.spyOn(immichProvider, 'isAssetInAlbum');

async function linkAlbum(groupId: string, overrides: Partial<{ externalAlbumId: string; albumName: string }> = {}) {
  return prisma.mediaAlbumLink.create({
    data: {
      groupId,
      provider: 'immich',
      externalAlbumId: overrides.externalAlbumId ?? randomUUID(),
      albumName: overrides.albumName ?? 'Family photos',
    },
  });
}

describe('immich integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getAlbumInfoMock.mockReset();
    listAlbumAssetsMock.mockReset();
    isAssetInAlbumMock.mockReset();
    // Default to "the asset is in the album" so tests that aren't exercising
    // that specific check (e.g. auth/membership 401/403 tests, which never
    // reach it) don't all need to set it up individually.
    isAssetInAlbumMock.mockResolvedValue(true);
  });

  describe('admin album linking', () => {
    it('non-admin gets 403 and no link is created', async () => {
      const nonAdmin = await createUser();
      const group = await createGroupWithMember(nonAdmin);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/media-albums`,
        headers: authHeader(nonAdmin),
        payload: { provider: 'immich', externalAlbumId: '11111111-1111-4111-8111-111111111111', albumName: 'Family photos' },
      });
      expect(res.statusCode).toBe(403);

      const links = await prisma.mediaAlbumLink.findMany({ where: { groupId: group.id } });
      expect(links).toHaveLength(0);
    });

    it('lets an admin link an album to a group', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/media-albums`,
        headers: authHeader(admin),
        payload: { provider: 'immich', externalAlbumId: '11111111-1111-4111-8111-111111111111', albumName: 'Family photos' },
      });
      expect(res.statusCode).toBe(200);

      const links = await prisma.mediaAlbumLink.findMany({ where: { groupId: group.id } });
      expect(links).toHaveLength(1);
      expect(links[0].albumName).toBe('Family photos');
      expect(links[0].provider).toBe('immich');
    });

    it('rejects linking the same album to a group twice', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/media-albums`,
        headers: authHeader(admin),
        payload: { provider: 'immich', externalAlbumId: link.externalAlbumId, albumName: 'Duplicate' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('lets an admin unlink an album', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/media-albums/${link.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
      expect(stored).toBeNull();
    });

    it('404s unlinking a non-existent link', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/media-albums/does-not-exist',
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('member-facing album/asset listing', () => {
    it('rejects a non-member listing a group\'s linked albums', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);
      await linkAlbum(group.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/groups/${group.id}/albums`,
        headers: authHeader(outsider),
      });
      expect(res.statusCode).toBe(403);
    });

    it('lets a member list their group\'s linked albums', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id, { albumName: 'Vacation 2025' });
      getAlbumInfoMock.mockResolvedValue({ assetCount: 12 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/groups/${group.id}/albums`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ linkId: link.id, albumName: 'Vacation 2025', assetCount: 12 }]);
    });

    it('rejects a non-member listing assets for a linked album', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/albums/${link.id}/assets`,
        headers: authHeader(outsider),
      });
      expect(res.statusCode).toBe(403);
    });

    it('gives thumbnail/preview a .jpg extension always, and original a .mp4 extension only for videos', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);
      listAlbumAssetsMock.mockResolvedValue([
        { id: 'asset-1', type: 'IMAGE', width: 100, height: 100, originalExt: 'jpg' },
        { id: 'asset-2', type: 'VIDEO', width: 100, height: 100, originalExt: 'mp4' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/albums/${link.id}/assets`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const assets = res.json();
      // thumbnail/preview always come back as a JPEG still from Immich, even
      // for a video — only original carries the asset's real type.
      expect(assets[0].thumbnailUrl).toBe(`/api/immich/assets/${link.id}/asset-1/thumbnail.jpg`);
      expect(assets[0].previewUrl).toBe(`/api/immich/assets/${link.id}/asset-1/preview.jpg`);
      expect(assets[0].originalUrl).toBe(`/api/immich/assets/${link.id}/asset-1/original.jpg`);
      expect(assets[1].thumbnailUrl).toBe(`/api/immich/assets/${link.id}/asset-2/thumbnail.jpg`);
      expect(assets[1].previewUrl).toBe(`/api/immich/assets/${link.id}/asset-2/preview.jpg`);
      expect(assets[1].originalUrl).toBe(`/api/immich/assets/${link.id}/asset-2/original.mp4`);
    });
  });

  describe('asset proxy authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/assets/${link.id}/some-asset-id/thumbnail.jpg`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a user who is not a member of the link\'s group', async () => {
      const member = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/assets/${link.id}/11111111-1111-4111-8111-111111111111/thumbnail.jpg`,
        headers: authHeader(outsider),
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s an unrecognized variant/extension shape', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/assets/${link.id}/11111111-1111-4111-8111-111111111111/thumbnail.exe`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s an asset id that does not actually belong to the linked album, even for a group member', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);
      // The requester is a member of the group the link belongs to, but the
      // requested asset isn't one of the album's actual assets — this is the
      // check that stops a member from reading arbitrary Immich assets (e.g.
      // ones belonging to an album linked to a different group, or never
      // linked to Famlin at all) once they learn an asset id from elsewhere.
      isAssetInAlbumMock.mockResolvedValue(false);

      const res = await app.inject({
        method: 'GET',
        url: `/api/immich/assets/${link.id}/11111111-1111-4111-8111-111111111111/thumbnail.jpg`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(404);
      expect(isAssetInAlbumMock).toHaveBeenCalledWith(link.externalAlbumId, '11111111-1111-4111-8111-111111111111');
    });
  });

  describe('asset proxy range forwarding', () => {
    // Native video players (iOS AVPlayer, Android ExoPlayer) stream mp4s via
    // byte-range requests and refuse to play when the server ignores them —
    // the proxy must forward Range to Immich and relay the 206 back.
    it('forwards the Range header to Immich and relays the partial response', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);
      const link = await linkAlbum(group.id);

      await updateSettings({ immichServerUrl: 'http://immich.local', immichApiKey: 'test-key' });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Uint8Array([0, 1]), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 0-1/12345',
            'accept-ranges': 'bytes',
          },
        })
      );

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/immich/assets/${link.id}/11111111-1111-4111-8111-111111111111/original.mp4`,
          headers: { ...authHeader(member), range: 'bytes=0-1' },
        });

        expect(res.statusCode).toBe(206);
        expect(res.headers['content-type']).toBe('video/mp4');
        expect(res.headers['content-range']).toBe('bytes 0-1/12345');
        expect(res.headers['accept-ranges']).toBe('bytes');

        const [, init] = fetchMock.mock.calls[0]!;
        expect((init!.headers as Record<string, string>).Range).toBe('bytes=0-1');
      } finally {
        fetchMock.mockRestore();
        await updateSettings({ immichServerUrl: '', immichApiKey: '' });
      }
    });
  });

  describe('getAlbumAssetPeople (asset-centric, cross-owner)', () => {
    afterEach(async () => {
      await updateSettings({ immichServerUrl: '', immichApiKey: '' });
    });

    it('paginates the bulk withPeople search, coercing the string nextPage cursor back to a number', async () => {
      await updateSettings({ immichServerUrl: 'http://immich.local', immichApiKey: 'test-key' });
      const albumId = randomUUID();

      const bulkSearchBodies: Array<Record<string, unknown>> = [];
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init: unknown) => {
        const req = init as RequestInit;
        const body = JSON.parse(req.body as string) as Record<string, unknown>;
        if (body.withPeople) {
          bulkSearchBodies.push(body);
          if (bulkSearchBodies.length === 1) {
            return new Response(
              JSON.stringify({
                assets: {
                  items: [{ id: 'asset-1', type: 'IMAGE', people: [{ id: 'p1', name: 'Person One' }] }],
                  nextPage: '2',
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ assets: { items: [{ id: 'asset-2', type: 'IMAGE', people: [] }], nextPage: null } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        // Coverage-check call (listAlbumAssets' plain search, no withPeople) —
        // both assets were already covered by the bulk search above.
        return new Response(
          JSON.stringify({
            assets: { items: [{ id: 'asset-1', type: 'IMAGE' }, { id: 'asset-2', type: 'IMAGE' }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      try {
        const result = await immichProvider.getAlbumAssetPeople!(albumId);
        expect(result.get('asset-1')).toEqual([{ id: 'p1', name: 'Person One' }]);
        expect(result.get('asset-2')).toEqual([]);

        expect(bulkSearchBodies).toHaveLength(2);
        // Immich returns nextPage as the string "2" but 400s if it's sent
        // back as a string — the second request must send it as a number.
        expect(bulkSearchBodies[1]).toMatchObject({ page: 2 });
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('falls back to an individual GET /assets/:id for an album asset the bulk search omitted entirely (cross-owner)', async () => {
      await updateSettings({ immichServerUrl: 'http://immich.local', immichApiKey: 'test-key' });
      const albumId = randomUUID();

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init: unknown) => {
        const urlStr = String(url);
        const req = init as RequestInit;
        if (urlStr.endsWith('/api/search/metadata')) {
          const body = JSON.parse(req.body as string) as Record<string, unknown>;
          if (body.withPeople) {
            // The bulk search only sees the asset owned by the API key
            // holder — the other, owned by a different Immich user in the
            // shared album, is silently absent (not merely empty-peopled).
            return new Response(
              JSON.stringify({
                assets: {
                  items: [{ id: 'asset-mine', type: 'IMAGE', people: [{ id: 'p1', name: 'Me' }] }],
                  nextPage: null,
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          // Coverage check: the album actually has two assets.
          return new Response(
            JSON.stringify({
              assets: { items: [{ id: 'asset-mine', type: 'IMAGE' }, { id: 'asset-other-owner', type: 'IMAGE' }] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (urlStr.endsWith('/api/assets/asset-other-owner')) {
          return new Response(JSON.stringify({ people: [{ id: 'p2', name: 'Other Owner Person' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch in test: ${urlStr}`);
      });

      try {
        const result = await immichProvider.getAlbumAssetPeople!(albumId);
        expect(result.get('asset-mine')).toEqual([{ id: 'p1', name: 'Me' }]);
        expect(result.get('asset-other-owner')).toEqual([{ id: 'p2', name: 'Other Owner Person' }]);
      } finally {
        fetchMock.mockRestore();
      }
    });
  });

  describe('cross-group isolation when attaching to a post', () => {
    it('rejects a post referencing an Immich URL linked to a different group', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      const linkForB = await linkAlbum(groupB.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: groupA.id,
          content: 'hi',
          uploadedAssetUrls: [`/api/immich/assets/${linkForB.id}/11111111-1111-4111-8111-111111111111/thumbnail.jpg`],
        },
      });
      expect(res.statusCode).toBe(400);

      const posts = await prisma.post.findMany({ where: { groupId: groupA.id } });
      expect(posts).toHaveLength(0);
    });

    it('accepts a post referencing an Immich URL linked to its own group', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'hi',
          uploadedAssetUrls: [`/api/immich/assets/${link.id}/11111111-1111-4111-8111-111111111111/thumbnail.jpg`],
        },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
