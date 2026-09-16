import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { uploadAssetKey } from '../src/services/uploads.js';

// The issue's hardest requirement: a non-member "must not be able to access
// its content through a direct API or media URL". Feed filtering is not
// enough — these exercise /uploads/* itself, with the exact URL in hand.

function multipart(filename: string, data: Buffer) {
  const boundary = '----FamlinCirclesBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

let app: FastifyInstance;
let author: Awaited<ReturnType<typeof createUser>>;
let insider: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;
let group: Awaited<ReturnType<typeof createGroup>>;
let circle: { id: string };
const createdKeys: string[] = [];

async function upload(user: { id: string; email: string; name: string; isAdmin: boolean }): Promise<string> {
  const image = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .jpeg()
    .toBuffer();
  const { body, contentType } = multipart('circle.jpg', image);
  const res = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { ...authHeader(user), 'content-type': contentType },
    payload: body,
  });
  expect(res.statusCode).toBe(200);
  const url: string = res.json().urls[0];
  createdKeys.push(uploadAssetKey(url));
  return url;
}

beforeAll(async () => {
  app = await buildTestApp();

  author = await createUser({ name: 'Photo Author' });
  insider = await createUser({ name: 'Photo Insider' });
  outsider = await createUser({ name: 'Photo Outsider' });

  group = await createGroup({ name: 'Photo Family' });
  for (const u of [author, insider, outsider]) await addMember(group.id, u.id);

  circle = await prisma.circle.create({
    data: {
      groupId: group.id,
      name: 'Private Album Circle',
      members: { create: [{ userId: author.id }, { userId: insider.id }] },
    },
  });
});

afterAll(async () => {
  const entries = await fsp.readdir(uploadsDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((f) => createdKeys.some((key) => f.startsWith(key)))
      .map((f) => fsp.unlink(path.join(uploadsDir, f)).catch(() => {}))
  );
  await Promise.all(
    createdKeys.map((key) => fsp.unlink(path.join(uploadsDir, 'originals', `${key}.jpg`)).catch(() => {}))
  );
  await prisma.group.deleteMany({ where: { id: group.id } });
  await prisma.user.deleteMany({ where: { id: { in: [author.id, insider.id, outsider.id] } } });
  await app.close();
});

describe('uploadAssetKey', () => {
  // Getting this wrong leaves thumbnails unprotected — which is the whole
  // photo at 400px — so every rendition shape the pipeline produces is pinned.
  it.each([
    ['/uploads/abc.jpg', 'abc'],
    ['/uploads/abc-thumbnail.jpg', 'abc'],
    ['/uploads/abc.mp4', 'abc'],
    ['/uploads/abc.heic', 'abc'],
    ['abc-thumbnail.jpg', 'abc'],
  ])('maps %s to %s', (input, expected) => {
    expect(uploadAssetKey(input)).toBe(expected);
  });
});

describe('circle-scoped media', () => {
  let circleAssetUrl: string;

  beforeAll(async () => {
    circleAssetUrl = await upload(author);
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        groupId: group.id,
        content: 'circle photo',
        circleId: circle.id,
        uploadedAssetUrls: [circleAssetUrl],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('serves the photo to a circle member', async () => {
    const res = await app.inject({ method: 'GET', url: circleAssetUrl, headers: authHeader(insider) });
    expect(res.statusCode).toBe(200);
  });

  it('refuses the photo to a group member outside the circle, with the exact URL', async () => {
    const res = await app.inject({ method: 'GET', url: circleAssetUrl, headers: authHeader(outsider) });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the thumbnail rendition too', async () => {
    const thumbnailUrl = circleAssetUrl.replace(/\.jpg$/, '-thumbnail.jpg');
    const res = await app.inject({ method: 'GET', url: thumbnailUrl, headers: authHeader(outsider) });
    expect(res.statusCode).toBe(404);
  });

  it('still refuses after the circle is deleted, rather than reverting to family-wide', async () => {
    const doomed = await prisma.circle.create({
      data: { groupId: group.id, name: 'Doomed Media', members: { create: [{ userId: author.id }] } },
    });
    const assetUrl = await upload(author);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'doomed', circleId: doomed.id, uploadedAssetUrls: [assetUrl] },
    });

    await prisma.circle.delete({ where: { id: doomed.id } });

    // The Upload row's circleId is deliberately not a foreign key, so it
    // survives the cascade as a dangling id that matches nobody. Fail-closed
    // is the right direction: a deleted circle's media must not become
    // readable family-wide.
    for (const user of [author, outsider]) {
      const res = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(user) });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('whole-family media is unaffected', () => {
  it('serves a normal post photo to every group member', async () => {
    const assetUrl = await upload(author);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'family photo', uploadedAssetUrls: [assetUrl] },
    });

    for (const user of [insider, outsider]) {
      const res = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(user) });
      expect(res.statusCode).toBe(200);
    }
  });

  it('serves an upload that predates the Upload table to anyone', async () => {
    const assetUrl = await upload(author);
    // Simulate a deployment upgrading with existing media: no Upload row.
    await prisma.upload.deleteMany({ where: { assetKey: uploadAssetKey(assetUrl) } });

    const res = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(outsider) });
    expect(res.statusCode).toBe(200);
  });

  it('keeps an unattached upload readable only by its uploader', async () => {
    const assetUrl = await upload(author);

    const own = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(author) });
    expect(own.statusCode).toBe(200);

    const other = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(insider) });
    expect(other.statusCode).toBe(404);
  });

  it('serves an avatar to everyone once set', async () => {
    const assetUrl = await upload(author);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeader(author),
      payload: { avatarUrl: assetUrl },
    });
    expect(res.statusCode).toBe(200);

    const seen = await app.inject({ method: 'GET', url: assetUrl, headers: authHeader(outsider) });
    expect(seen.statusCode).toBe(200);
  });
});

describe('circle media in the photo timeline', () => {
  it('omits circle photos for an outsider but includes them for a member', async () => {
    const assetUrl = await upload(author);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        groupId: group.id,
        content: 'timeline circle photo',
        circleId: circle.id,
        uploadedAssetUrls: [assetUrl],
      },
    });

    const outsiderRes = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(outsider),
    });
    expect(outsiderRes.statusCode).toBe(200);
    expect(JSON.stringify(outsiderRes.json().items)).not.toContain(assetUrl);

    const insiderRes = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(insider),
    });
    expect(JSON.stringify(insiderRes.json().items)).toContain(assetUrl);
  });
});
