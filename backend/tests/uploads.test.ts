import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { buildTestApp, createUser, createGroup, addMember, authHeader } from './helpers.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';

function buildMultipartBody(filename: string, contentType: string, data: Buffer) {
  const boundary = '----FamlinTestBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function waitForProcessing(app: FastifyInstance, uuid: string, member: Parameters<typeof authHeader>[0], status = 'ready') {
  await vi.waitFor(async () => {
    const response = await app.inject({ method: 'GET', url: `/api/uploads/status/${uuid}`, headers: authHeader(member) });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(status);
  }, { timeout: 10000, interval: 100 });
}

// End-to-end tests for direct-upload compression: a large JPEG gets a
// resized display copy at its canonical URL, the true original is preserved
// but unreachable. GIFs stay unchanged; undecodable uploads report failure.
// Uses a real JPEG (universally decodable by any sharp build) rather than a
// real HEIC fixture, since HEIC decode support depends on the Docker image's
// Alpine vips-heif package (see backend/Dockerfile) — not guaranteed in the
// environment `npm test` runs in.
describe('POST /api/uploads — compression', () => {
  let app: FastifyInstance;
  const writtenUuids: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    // Clean up every file this suite may have created under uploads/ and
    // uploads/originals/, so repeated local test runs don't accumulate cruft
    // in whichever directory is in use (scripts/test-in-docker.sh points
    // UPLOADS_DIR at a throwaway path, but a plain `npm test` still writes
    // into the real dev uploads directory).
    for (const uuid of writtenUuids.splice(0)) {
      const entries = await fsp.readdir(uploadsDir).catch(() => [] as string[]);
      await Promise.all(
        entries.filter((f) => f.startsWith(uuid)).map((f) => fsp.unlink(path.join(uploadsDir, f)).catch(() => {}))
      );
      await fsp.rm(path.join(uploadsDir, 'originals', uuid), { recursive: true, force: true });
      const originals = await fsp.readdir(path.join(uploadsDir, 'originals')).catch(() => [] as string[]);
      await Promise.all(originals.filter((f) => f.startsWith(uuid)).map((f) => fsp.unlink(path.join(uploadsDir, 'originals', f)).catch(() => {})));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a resized display copy at a .jpg canonical URL and preserves the true original unreachably', async () => {
    const member = await createUser();
    // Larger than the 1920px display-copy cap so the resize is observable.
    const original = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const { body, contentType } = buildMultipartBody('photo.jpg', 'image/jpeg', original);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const { urls } = uploadRes.json();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    const uuid = urls[0].match(/\/uploads\/([0-9a-f-]{36})\.jpg$/)![1];
    writtenUuids.push(uuid);

    expect(uploadRes.json().media[0]).toMatchObject({ status: 'queued', thumbnailUrl: `/uploads/${uuid}-thumbnail.jpg` });
    await waitForProcessing(app, uuid, member);
    const displayRes = await app.inject({ method: 'GET', url: urls[0], headers: authHeader(member) });
    expect(displayRes.statusCode).toBe(200);
    const displayMeta = await sharp(displayRes.rawPayload).metadata();
    expect(displayMeta.format).toBe('jpeg');
    expect(displayMeta.width).toBe(1920);
    expect(displayRes.rawPayload.length).toBeLessThan(original.length);

    const thumbRes = await app.inject({
      method: 'GET',
      url: `/uploads/${uuid}-thumbnail.jpg`,
      headers: authHeader(member),
    });
    expect(thumbRes.statusCode).toBe(200);
    const thumbMeta = await sharp(thumbRes.rawPayload).metadata();
    expect(thumbMeta.format).toBe('jpeg');
    expect(thumbMeta.width).toBe(400);

    // The true original is preserved on disk (for a possible future
    // "download original" feature) but never served through any route.
    const originalOnDisk = await sharp(path.join(uploadsDir, 'originals', uuid, 'photo.jpg')).metadata();
    expect(originalOnDisk.width).toBe(3000);
    const originalsRes = await app.inject({
      method: 'GET',
      url: `/uploads/originals/${uuid}.jpg`,
      headers: authHeader(member),
    });
    expect(originalsRes.statusCode).toBe(404);
  });

  it('reports failed processing for an undecodable image', async () => {
    const member = await createUser();
    const garbage = Buffer.from('not a real heic file, just bytes with a .heic extension');

    const { body, contentType } = buildMultipartBody('broken.heic', 'image/heic', garbage);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const { urls } = uploadRes.json();
    expect(urls[0]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    const uuid = urls[0].match(/\/uploads\/([0-9a-f-]{36})\.jpg$/)![1];
    writtenUuids.push(uuid);
    expect(uploadRes.json().media[0].thumbnailUrl).toBeNull();
    await waitForProcessing(app, uuid, member, 'failed');
    const res = await app.inject({ method: 'GET', url: `/uploads/originals/${uuid}.heic`, headers: authHeader(member) });
    expect(res.statusCode).toBe(404);

  });

  it('accepts a post while media is queued and protects status from other users', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroup();
    await addMember(group.id, member.id);
    const original = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } }).jpeg().toBuffer();
    const { body, contentType } = buildMultipartBody('photo.jpg', 'image/jpeg', original);
    const uploaded = await app.inject({ method: 'POST', url: '/api/uploads', headers: { ...authHeader(member), 'content-type': contentType }, payload: body });
    const { urls, media } = uploaded.json();
    expect(media[0].status).toBe('queued');
    const uuid = urls[0].split('/').pop().split('.')[0];
    writtenUuids.push(uuid);
    const post = await app.inject({ method: 'POST', url: '/api/posts', headers: authHeader(member), payload: { groupId: group.id, content: 'Processing photo', uploadedAssetUrls: urls } });
    expect(post.statusCode).toBe(200);
    const denied = await app.inject({ method: 'GET', url: `/api/uploads/status/${uuid}`, headers: authHeader(outsider) });
    expect(denied.statusCode).toBe(404);
    await waitForProcessing(app, uuid, member);
  });

  it('returns a video poster and converts MOV to H.264 MP4 in the background', async () => {
    const member = await createUser();
    const temporary = `/tmp/famlin-video-${randomUUID()}.mov`;
    const exec = promisify(execFile);
    try {
      await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.5', '-c:v', 'mpeg4', temporary]);
      const { body, contentType } = buildMultipartBody('clip.mov', 'video/quicktime', await fsp.readFile(temporary));
      const response = await app.inject({ method: 'POST', url: '/api/uploads', headers: { ...authHeader(member), 'content-type': contentType }, payload: body });
      expect(response.statusCode).toBe(200);
      const { urls, media } = response.json();
      expect(urls[0]).toMatch(/\.mp4$/);
      expect(media[0]).toMatchObject({ status: 'queued', url: urls[0] });
      const uuid = urls[0].split('/').pop().split('.')[0];
      writtenUuids.push(uuid);
      const preview = await app.inject({ method: 'GET', url: media[0].thumbnailUrl, headers: authHeader(member) });
      expect(preview.statusCode).toBe(200);
      await waitForProcessing(app, uuid, member);
      const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-of', 'json', path.join(uploadsDir, `${uuid}.mp4`)]);
      expect(JSON.parse(stdout).streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 240 });
    } finally { await fsp.unlink(temporary).catch(() => {}); }
  });

  it('recovers a job left processing by a crashed worker', async () => {
    const member = await createUser();
    const uuid = randomUUID();
    writtenUuids.push(uuid);
    await sharp({ create: { width: 80, height: 60, channels: 3, background: 'blue' } }).jpeg().toFile(path.join(uploadsDir, 'originals', `${uuid}.jpg`));
    await prisma.upload.create({ data: { assetKey: uuid, uploaderId: member.id, sourceFilename: `${uuid}.jpg`, mediaUrl: `/uploads/${uuid}.jpg`, processingStatus: 'processing', processingStartedAt: new Date(Date.now() - 20 * 60_000) } });
    await waitForProcessing(app, uuid, member);
  });

  it('stores and serves a .gif upload unprocessed (no resize, animation-safe)', async () => {
    const member = await createUser();
    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .gif()
      .toBuffer();

    const { body, contentType } = buildMultipartBody('reaction.gif', 'image/gif', gif);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const { urls } = uploadRes.json();
    expect(urls[0]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.gif$/);
    const uuid = urls[0].match(/\/uploads\/([0-9a-f-]{36})\.gif$/)![1];
    writtenUuids.push(uuid);

    const res = await app.inject({ method: 'GET', url: urls[0], headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(gif)).toBe(true);
  });
});

// Uploads stored under a .heic/.heif extension — everything predating the
// compression pipeline, plus any upload whose conversion failed — are served
// as generated JPEGs so non-Safari browsers can render them at all.
//
// The fixtures are JPEG bytes written under a .heic filename rather than real
// HEIC files: sharp sniffs content instead of trusting the extension, so this
// exercises the whole plan/generate/serve path while staying decodable in an
// environment whose sharp build has no HEIF support (see backend/Dockerfile —
// only the production image compiles against vips-heif).
describe('GET /uploads/<uuid>.heic — legacy HEIC renditions', () => {
  let app: FastifyInstance;
  const writtenUuids: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    for (const uuid of writtenUuids.splice(0)) {
      for (const dir of [uploadsDir, path.join(uploadsDir, 'derived')]) {
        const entries = await fsp.readdir(dir).catch(() => [] as string[]);
        await Promise.all(
          entries.filter((f) => f.startsWith(uuid)).map((f) => fsp.unlink(path.join(dir, f)).catch(() => {}))
        );
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function writeLegacyUpload(ext: string, width: number, height: number): Promise<string> {
    const uuid = randomUUID();
    writtenUuids.push(uuid);
    const bytes = await sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 60, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    await fsp.writeFile(path.join(uploadsDir, `${uuid}${ext}`), bytes);
    return uuid;
  }

  it('serves a JPEG rendition at the stored .heic URL', async () => {
    const member = await createUser();
    const uuid = await writeLegacyUpload('.heic', 3000, 2000);

    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${uuid}.heic`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1920);

    // Second request is served from the cached rendition, not regenerated.
    const cached = await app.inject({
      method: 'GET',
      url: `/uploads/${uuid}.heic`,
      headers: authHeader(member),
    });
    expect(cached.statusCode).toBe(200);
    expect(cached.rawPayload.equals(res.rawPayload)).toBe(true);
  });

  it('generates the missing -thumbnail.jpg sibling for a legacy .heif upload', async () => {
    const member = await createUser();
    const uuid = await writeLegacyUpload('.heif', 1200, 900);

    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${uuid}-thumbnail.jpg`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(400);
  });

  it('never serves the generated renditions under their own path', async () => {
    const member = await createUser();
    const uuid = await writeLegacyUpload('.heic', 800, 600);
    await app.inject({ method: 'GET', url: `/uploads/${uuid}.heic`, headers: authHeader(member) });

    const res = await app.inject({
      method: 'GET',
      url: `/uploads/derived/${uuid}.jpg`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(404);
  });

  it('leaves a non-HEIC upload untouched', async () => {
    const member = await createUser();
    const uuid = randomUUID();
    writtenUuids.push(uuid);
    const bytes = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();
    await fsp.writeFile(path.join(uploadsDir, `${uuid}.png`), bytes);

    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${uuid}.png`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });
});
