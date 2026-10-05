import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { canReadUpload, recordServerCopy, uploadAssetKey } from '../src/services/uploads.js';

// Issue #184: a bound, non-circle upload used to be readable by every
// signed-in user on the server, protected only by its random filename. These
// pin that /uploads/* now enforces the core rule — a user never sees another
// group's content — with the exact URL in hand.

type TestUser = Awaited<ReturnType<typeof createUser>>;

function multipart(data: Buffer) {
  const boundary = '----FamlinGroupUploadsBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="photo.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

let app: FastifyInstance;
let alice: TestUser; // in A and B
let anna: TestUser; // in A only
let bob: TestUser; // in B only
let carol: TestUser; // in C only
let groupA: Awaited<ReturnType<typeof createGroup>>;
let groupB: Awaited<ReturnType<typeof createGroup>>;
let groupC: Awaited<ReturnType<typeof createGroup>>;
const createdKeys: string[] = [];

async function upload(user: TestUser): Promise<string> {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
  const { body, contentType } = multipart(image);
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

async function status(url: string, user: TestUser): Promise<number> {
  return (await app.inject({ method: 'GET', url, headers: authHeader(user) })).statusCode;
}

beforeAll(async () => {
  app = await buildTestApp();
  alice = await createUser({ name: 'Alice Both' });
  anna = await createUser({ name: 'Anna A' });
  bob = await createUser({ name: 'Bob B' });
  carol = await createUser({ name: 'Carol C' });
  groupA = await createGroup({ name: 'Family A' });
  groupB = await createGroup({ name: 'Family B' });
  groupC = await createGroup({ name: 'Family C' });
  await addMember(groupA.id, alice.id);
  await addMember(groupB.id, alice.id);
  await addMember(groupA.id, anna.id);
  await addMember(groupB.id, bob.id);
  await addMember(groupC.id, carol.id);
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
  await app.close();
});

describe('group-scoped post media', () => {
  let photoUrl: string;

  beforeAll(async () => {
    photoUrl = await upload(anna);
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(anna),
      payload: { groupId: groupA.id, content: 'group A only', uploadedAssetUrls: [photoUrl] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('serves the photo to members of its group', async () => {
    expect(await status(photoUrl, alice)).toBe(200);
  });

  it('refuses it to a member of another group, with the exact URL', async () => {
    expect(await status(photoUrl, bob)).toBe(404);
  });

  it('refuses the thumbnail rendition too', async () => {
    expect(await status(photoUrl.replace(/\.jpg$/, '-thumbnail.jpg'), bob)).toBe(404);
  });

  it('refuses it through a media token as well as a session token', async () => {
    const tokenRes = await app.inject({ method: 'GET', url: '/api/uploads/media-token', headers: authHeader(bob) });
    const outsider = await app.inject({ method: 'GET', url: `${photoUrl}?token=${tokenRes.json().token}` });
    expect(outsider.statusCode).toBe(404);

    const memberToken = await app.inject({ method: 'GET', url: '/api/uploads/media-token', headers: authHeader(alice) });
    const member = await app.inject({ method: 'GET', url: `${photoUrl}?token=${memberToken.json().token}` });
    expect(member.statusCode).toBe(200);
  });

  it('revokes access when the reader is removed from the group', async () => {
    const leaver = await createUser({ name: 'Leaving Larry' });
    await addMember(groupA.id, leaver.id);
    expect(await status(photoUrl, leaver)).toBe(200);

    await prisma.groupMember.deleteMany({ where: { groupId: groupA.id, userId: leaver.id } });
    expect(await status(photoUrl, leaver)).toBe(404);
  });
});

describe('cross-posted media', () => {
  it('is readable from every target group and nowhere else', async () => {
    const photoUrl = await upload(alice);
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(alice),
      payload: { groupIds: [groupA.id, groupB.id], content: 'both families', uploadedAssetUrls: [photoUrl] },
    });
    expect(res.statusCode).toBe(200);

    expect(await status(photoUrl, anna)).toBe(200);
    expect(await status(photoUrl, bob)).toBe(200);
    expect(await status(photoUrl, carol)).toBe(404);
  });

  it('adds a group when the uploader re-shares their photo into another group', async () => {
    const photoUrl = await upload(alice);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(alice),
      payload: { groupId: groupA.id, content: 'first share', uploadedAssetUrls: [photoUrl] },
    });
    expect(await status(photoUrl, bob)).toBe(404);

    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(alice),
      payload: { groupId: groupB.id, content: 'second share', uploadedAssetUrls: [photoUrl] },
    });
    expect(await status(photoUrl, bob)).toBe(200);
    expect(await status(photoUrl, anna)).toBe(200);

    // Adding, not replacing — and an edit re-binding the same photo doesn't
    // pile up duplicate group ids.
    const row = await prisma.upload.findUnique({ where: { assetKey: uploadAssetKey(photoUrl) } });
    expect([...row!.groupIds].sort()).toEqual([groupA.id, groupB.id].sort());
  });

  it("doesn't let someone else widen a photo by re-sharing its URL", async () => {
    const photoUrl = await upload(anna);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(anna),
      payload: { groupId: groupA.id, content: 'mine', uploadedAssetUrls: [photoUrl] },
    });
    // alice can read it (she's in A) and posts its URL into B.
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(alice),
      payload: { groupId: groupB.id, content: 'look', uploadedAssetUrls: [photoUrl] },
    });
    expect(await status(photoUrl, bob)).toBe(404);
  });
});

describe('server-side copies', () => {
  it('get a row scoped to the groups they were copied for', async () => {
    const copyUrl = `/uploads/${randomUUID()}.jpg`;
    await recordServerCopy(copyUrl, alice.id, [groupA.id, groupB.id]);

    expect(await canReadUpload(copyUrl, anna.id)).toBe(true);
    expect(await canReadUpload(copyUrl, bob.id)).toBe(true);
    expect(await canReadUpload(copyUrl, carol.id)).toBe(false);
  });
});

describe('comment and chat attachments', () => {
  it('scopes a comment photo to the post\'s group', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(anna),
      payload: { groupId: groupA.id, content: 'comment on me' },
    });
    const photoUrl = await upload(alice);
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${post.json().id}/comments`,
      headers: authHeader(alice),
      payload: { attachmentUrls: [photoUrl] },
    });
    expect(res.statusCode).toBe(200);

    expect(await status(photoUrl, anna)).toBe(200);
    expect(await status(photoUrl, bob)).toBe(404);
  });

  it('scopes a chat attachment to the chat\'s group', async () => {
    await prisma.group.update({ where: { id: groupB.id }, data: { chitchatEnabled: true } });
    const photoUrl = await upload(bob);
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/groups/${groupB.id}/messages`,
      headers: authHeader(bob),
      payload: { attachmentUrl: photoUrl },
    });
    expect(res.statusCode).toBe(200);

    expect(await status(photoUrl, alice)).toBe(200);
    expect(await status(photoUrl, anna)).toBe(404);
  });
});

describe('avatars', () => {
  it('stay readable server-wide, including by users sharing no group', async () => {
    const avatarUrl = await upload(carol);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeader(carol),
      payload: { avatarUrl },
    });
    expect(res.statusCode).toBe(200);

    expect(await status(avatarUrl, anna)).toBe(200);
    expect(await status(avatarUrl, bob)).toBe(200);
  });

  it("don't widen a group photo the uploader later sets as their avatar", async () => {
    const photoUrl = await upload(anna);
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(anna),
      payload: { groupId: groupA.id, content: 'family only', uploadedAssetUrls: [photoUrl] },
    });
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: authHeader(anna), payload: { avatarUrl: photoUrl } });

    expect(await status(photoUrl, carol)).toBe(404);
  });
});

describe('legacy rows', () => {
  it('keeps a row bound before group scoping readable until it is backfilled', async () => {
    const photoUrl = await upload(anna);
    await prisma.upload.update({
      where: { assetKey: uploadAssetKey(photoUrl) },
      data: { bound: true, groupIds: [], serverWide: false },
    });
    expect(await status(photoUrl, carol)).toBe(200);
  });
});
