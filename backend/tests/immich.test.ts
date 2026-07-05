import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js';

// listImmichAlbums/getImmichAlbumAssets/getImmichAlbumInfo talk to a real
// Immich server over fetch — mocked here so these tests exercise
// route/authorization logic (admin guard, group membership, cross-group
// isolation) rather than a live Immich instance. isAssetInAlbum is mocked
// too: routes/immich.ts imports it as a cross-module reference, so mocking it
// here works cleanly, whereas its own real implementation (which calls
// getImmichAlbumAssets internally) can't be exercised this way — see the
// dedicated 'asset proxy authorization' tests below for what's actually
// covered. ImmichError is re-exported as-is so `instanceof` checks in the
// routes still work.
vi.mock('../src/services/immich.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/immich.js')>();
  return {
    ...actual,
    listImmichAlbums: vi.fn(),
    getImmichAlbumAssets: vi.fn(),
    getImmichAlbumInfo: vi.fn(),
    isAssetInAlbum: vi.fn(),
  };
});

const immichService = await import('../src/services/immich.js');
const listImmichAlbumsMock = vi.mocked(immichService.listImmichAlbums);
const getImmichAlbumAssetsMock = vi.mocked(immichService.getImmichAlbumAssets);
const getImmichAlbumInfoMock = vi.mocked(immichService.getImmichAlbumInfo);
const isAssetInAlbumMock = vi.mocked(immichService.isAssetInAlbum);

async function linkAlbum(groupId: string, overrides: Partial<{ immichAlbumId: string; albumName: string }> = {}) {
  return prisma.immichAlbumLink.create({
    data: {
      groupId,
      immichAlbumId: overrides.immichAlbumId ?? randomUUID(),
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
    listImmichAlbumsMock.mockReset();
    getImmichAlbumAssetsMock.mockReset();
    getImmichAlbumInfoMock.mockReset();
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
        url: `/api/admin/groups/${group.id}/immich-albums`,
        headers: authHeader(nonAdmin),
        payload: { immichAlbumId: '11111111-1111-4111-8111-111111111111', albumName: 'Family photos' },
      });
      expect(res.statusCode).toBe(403);

      const links = await prisma.immichAlbumLink.findMany({ where: { groupId: group.id } });
      expect(links).toHaveLength(0);
    });

    it('lets an admin link an album to a group', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/immich-albums`,
        headers: authHeader(admin),
        payload: { immichAlbumId: '11111111-1111-4111-8111-111111111111', albumName: 'Family photos' },
      });
      expect(res.statusCode).toBe(200);

      const links = await prisma.immichAlbumLink.findMany({ where: { groupId: group.id } });
      expect(links).toHaveLength(1);
      expect(links[0].albumName).toBe('Family photos');
    });

    it('rejects linking the same album to a group twice', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/immich-albums`,
        headers: authHeader(admin),
        payload: { immichAlbumId: link.immichAlbumId, albumName: 'Duplicate' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('lets an admin unlink an album', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);
      const link = await linkAlbum(group.id);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/immich-albums/${link.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);

      const stored = await prisma.immichAlbumLink.findUnique({ where: { id: link.id } });
      expect(stored).toBeNull();
    });

    it('404s unlinking a non-existent link', async () => {
      const admin = await createUser({ isAdmin: true });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/immich-albums/does-not-exist',
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
      getImmichAlbumInfoMock.mockResolvedValue({ assetCount: 12 });

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
      getImmichAlbumAssetsMock.mockResolvedValue([
        { id: 'asset-1', type: 'IMAGE', width: 100, height: 100 },
        { id: 'asset-2', type: 'VIDEO', width: 100, height: 100 },
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
      expect(isAssetInAlbumMock).toHaveBeenCalledWith(link.immichAlbumId, '11111111-1111-4111-8111-111111111111');
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
