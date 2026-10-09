import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, createGroup, addMember, authHeader, waitForUploadReady } from './helpers.js';
import { deleteUploadFiles } from '../src/services/uploads.js';
import { prisma } from '../src/db.js';

const exec = promisify(execFile);
let app: FastifyInstance;
const urls: string[] = [];
let video: Buffer;
let photo: Buffer;
beforeAll(async () => {
  app = await buildTestApp();
  const file = `/tmp/famlin-live-${randomUUID()}.mov`;
  try {
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=0.5', '-c:v', 'mpeg4', file]);
    video = await fs.readFile(file);
  } finally { await fs.unlink(file).catch(() => {}); }
  photo = await sharp({ create: { width: 240, height: 180, channels: 3, background: 'red' } }).jpeg().toBuffer();
});
afterEach(async () => { for (const url of urls.splice(0)) await deleteUploadFiles(url); });
afterAll(async () => { await app.close(); });
async function upload(name: string | null, bytes: Buffer, user: Awaited<ReturnType<typeof createUser>>, sessionId?: string, excluded: string[] = []) {
  const boundary = 'FamlinLivePhotoTest';
  const payload = name ? Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]) : Buffer.from(`--${boundary}--\r\n`);
  const response = await app.inject({ method: 'POST', url: '/api/uploads', headers: { ...authHeader(user), 'content-type': `multipart/form-data; boundary=${boundary}`,
    ...(sessionId ? { 'x-upload-session-id': sessionId } : {}), ...(excluded.length ? { 'x-upload-session-exclude': JSON.stringify(excluded) } : {}) }, payload });
  expect(response.statusCode).toBe(200);
  const result = response.json();
  for (const url of result.urls) { urls.push(url); await waitForUploadReady(app, url, user); }
  return result;
}
const key = (url: string) => path.basename(url).split('.')[0];

describe('Live Photos inside upload sessions', () => {
  it.each([false, true])('merges separately uploaded files in either order (MOV first: %s)', async (movFirst) => {
    const owner = await createUser(); const session = randomUUID();
    const first = await upload(movFirst ? 'IMG_1234.MOV' : 'IMG_1234.HEIC', movFirst ? video : photo, owner, session);
    expect(first.sessionMedia).toHaveLength(1);
    const second = await upload(movFirst ? 'IMG_1234.HEIC' : 'IMG_1234.MOV', movFirst ? photo : video, owner, session);
    expect(second.sessionMedia).toHaveLength(1);
    const live = second.sessionMedia[0];
    expect(live.kind).toBe('livePhoto'); expect(live.url).toMatch(/\.jpg$/); expect(live.videoUrl).toMatch(/\.mp4$/);
    expect((await prisma.upload.findUniqueOrThrow({ where: { assetKey: key(live.url) } })).motionAssetKey).toBe(key(live.videoUrl));
  });

  it('serializes concurrent completions and returns one stable pair', async () => {
    const owner = await createUser(); const session = randomUUID();
    const results = await Promise.all([upload('IMG_1234.HEIC', photo, owner, session), upload('IMG_1234.MOV', video, owner, session)]);
    const normalized = await upload(null, Buffer.alloc(0), owner, session);
    expect(normalized.sessionMedia).toHaveLength(1);
    expect(normalized.sessionMedia[0].kind).toBe('livePhoto');
    expect(results.some((result) => result.sessionMedia.some((item: { kind: string }) => item.kind === 'livePhoto'))).toBe(true);
  });

  it('removes a complete pair from matching and refuses another user’s exclusions', async () => {
    const owner = await createUser(); const outsider = await createUser(); const session = randomUUID();
    await upload('IMG_1234.HEIC', photo, owner, session);
    const { sessionMedia: [live] } = await upload('IMG_1234.MOV', video, owner, session);
    await upload(null, Buffer.alloc(0), outsider, session, [key(live.url)]);
    expect((await prisma.upload.findUniqueOrThrow({ where: { assetKey: key(live.url) } })).motionAssetKey).toBe(key(live.videoUrl));
    const removed = await upload(null, Buffer.alloc(0), owner, session, [key(live.url)]);
    expect(removed.sessionMedia).toEqual([]);
    for (const url of [live.url, live.videoUrl]) expect((await prisma.upload.findUniqueOrThrow({ where: { assetKey: key(url) } })).uploadSessionId).toBeNull();
  });

  it('does not match across drafts or users, even with identical names', async () => {
    const owner = await createUser(); const other = await createUser(); const session = randomUUID();
    await upload('IMG_1234.HEIC', photo, owner, session);
    const differentDraft = await upload('IMG_1234.MOV', video, owner, randomUUID());
    expect(differentDraft.sessionMedia[0].kind).toBe('video');
    const differentUser = await upload('IMG_1234.MOV', video, other, session);
    expect(differentUser.sessionMedia).toHaveLength(1); expect(differentUser.sessionMedia[0].kind).toBe('video');
  });

  it('binds both components and never modifies published media through a later upload', async () => {
    const owner = await createUser(); const member = await createUser(); const outsider = await createUser(); const session = randomUUID();
    const group = await createGroup(); await addMember(group.id, owner.id); await addMember(group.id, member.id);
    await upload('IMG_1234.HEIC', photo, owner, session);
    const { sessionMedia: [live] } = await upload('IMG_1234.MOV', video, owner, session);
    const post = await app.inject({ method: 'POST', url: '/api/posts', headers: authHeader(owner), payload: { groupId: group.id, uploadedAssetUrls: [live.url] } });
    expect(post.statusCode).toBe(200); expect(post.json().uploadedAssetUrls).toEqual([live.url]);
    for (const url of [live.url, live.videoUrl]) {
      expect((await app.inject({ method: 'GET', url, headers: authHeader(member) })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url, headers: authHeader(outsider) })).statusCode).toBe(404);
      expect((await prisma.upload.findUniqueOrThrow({ where: { assetKey: key(url) } })).uploadSessionId).toBeNull();
    }
    const later = await upload('IMG_1234.MOV', video, owner, session);
    expect(later.sessionMedia).toHaveLength(1); expect(later.sessionMedia[0].kind).toBe('video');
    expect((await prisma.upload.findUniqueOrThrow({ where: { assetKey: key(live.url) } })).motionAssetKey).toBe(key(live.videoUrl));
  });

  it('excludes removed files through upload instead of matching them later', async () => {
    const owner = await createUser(); const session = randomUUID();
    const first = await upload('IMG_1234.HEIC', photo, owner, session);
    const removed = await upload(null, Buffer.alloc(0), owner, session, [key(first.urls[0])]);
    expect(removed.sessionMedia).toEqual([]);
    const second = await upload('IMG_1234.MOV', video, owner, session);
    expect(second.sessionMedia[0].kind).toBe('video');
  });

  it('does not infer a pair from names if an Apple identifier is present in only one file', async () => {
    const owner = await createUser(); const session = randomUUID(); const file = `/tmp/famlin-id-${randomUUID()}.mov`;
    try {
      await fs.writeFile(file, video);
      await exec('exiftool', ['-overwrite_original', `-Keys:ContentIdentifier=${randomUUID()}`, file]);
      await upload('IMG_1234.HEIC', photo, owner, session);
      const result = await upload('IMG_1234.MOV', await fs.readFile(file), owner, session);
      expect(result.sessionMedia).toHaveLength(2); expect(result.sessionMedia.every((item: { kind: string }) => item.kind !== 'livePhoto')).toBe(true);
    } finally { await fs.unlink(file).catch(() => {}); }
  });

  it('keeps uploads without a session separate and removes the old linking endpoint', async () => {
    const owner = await createUser();
    const result = await upload('IMG_1234.HEIC', photo, owner);
    expect(result.sessionMedia).toBeUndefined();
    const response = await app.inject({ method: 'POST', url: '/api/uploads/live-photo', headers: authHeader(owner), payload: {} });
    expect(response.statusCode).toBe(404);
  });
});
