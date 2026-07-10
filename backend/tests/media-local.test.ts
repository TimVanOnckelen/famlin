import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../src/db.js';
import { updateSettings } from '../src/services/settings.js';
import { encodeLocalAssetId } from '../src/services/media/local.js';
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js';

// End-to-end tests for the local-folder media provider against a real temp
// directory: albums = subdirectories, assets = image files, thumbnails
// generated with sharp, and the same authorization contract as Immich
// (link -> group membership -> asset-in-album re-check).
describe('local-folder media provider', () => {
  let app: FastifyInstance;
  let root: string;

  async function linkSummerAlbum(groupId: string) {
    return prisma.mediaAlbumLink.create({
      data: { groupId, provider: 'local', externalAlbumId: 'summer', albumName: 'Summer' },
    });
  }

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-local-media-'));
    await fsp.mkdir(path.join(root, 'summer'));
    // A real decodable image, so the thumbnail rendition pipeline runs for real.
    await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .toFile(path.join(root, 'summer', 'beach.jpg'));
    // Non-image files must be ignored by listings.
    await fsp.writeFile(path.join(root, 'summer', 'notes.txt'), 'not a photo');
    // A file OUTSIDE any album — the traversal test tries to reach it.
    await fsp.writeFile(path.join(root, 'root-secret.jpg'), 'outside albums');

    await updateSettings({ localMediaPath: root });
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
    await updateSettings({ localMediaPath: '' });
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('lists a group\'s linked local album with its image count', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/albums`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    // notes.txt is not an image, so the count is 1.
    expect(res.json()).toEqual([{ linkId: link.id, provider: 'local', albumName: 'Summer', assetCount: 1 }]);
  });

  it('lists album assets with generic media proxy URLs', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);
    const assetId = encodeLocalAssetId('beach.jpg');

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/albums/${link.id}/assets`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        assetId,
        type: 'IMAGE',
        width: null,
        height: null,
        thumbnailUrl: `/api/media/assets/${link.id}/${assetId}/thumbnail.jpg`,
        previewUrl: `/api/media/assets/${link.id}/${assetId}/preview.jpg`,
        originalUrl: `/api/media/assets/${link.id}/${assetId}/original.jpg`,
      },
    ]);
  });

  it('serves a generated thumbnail as JPEG', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/assets/${link.id}/${encodeLocalAssetId('beach.jpg')}/thumbnail.jpg`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(32);
  });

  it('serves the original with Range support', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);
    const size = (await fsp.stat(path.join(root, 'summer', 'beach.jpg'))).size;

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/assets/${link.id}/${encodeLocalAssetId('beach.jpg')}/original.jpg`,
      headers: { ...authHeader(member), range: 'bytes=0-9' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${size}`);
    expect(res.headers['content-length']).toBe('10');
    expect(res.rawPayload.length).toBe(10);
  });

  it('404s a traversal attempt to a file outside the album', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/assets/${link.id}/${encodeLocalAssetId('../root-secret.jpg')}/original.jpg`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-member reading a linked local asset', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(member);
    const link = await linkSummerAlbum(group.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/assets/${link.id}/${encodeLocalAssetId('beach.jpg')}/thumbnail.jpg`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects linking an album id that could escape the root', async () => {
    const admin = await createUser({ isAdmin: true });
    const group = await createGroupWithMember(admin);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/groups/${group.id}/media-albums`,
      headers: authHeader(admin),
      payload: { provider: 'local', externalAlbumId: '../etc', albumName: 'Nope' },
    });
    expect(res.statusCode).toBe(400);

    const links = await prisma.mediaAlbumLink.findMany({ where: { groupId: group.id } });
    expect(links).toHaveLength(0);
  });

  it('lets an admin list local albums for the picker', async () => {
    const admin = await createUser({ isAdmin: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/media/local/albums',
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'summer', name: 'summer', assetCount: 1 }]);
  });
});
