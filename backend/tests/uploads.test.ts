import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader } from './helpers.js';

const uploadsDir = path.join(process.cwd(), 'uploads');

function buildMultipartBody(filename: string, contentType: string, data: Buffer) {
  return buildMultiFileMultipartBody([{ filename, contentType, data }]);
}

// Builds a single multipart body carrying several files under the same
// "file" field, in the given order — used to exercise the route's
// bounded-concurrency post-processing phase across more than one upload.
function buildMultiFileMultipartBody(files: { filename: string; contentType: string; data: Buffer }[]) {
  const boundary = '----FamlinTestBoundary';
  const parts = files.map((f) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`
      ),
      f.data,
      Buffer.from('\r\n'),
    ])
  );
  const body = Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// End-to-end tests for direct-upload compression: a large JPEG gets a
// resized display copy at its canonical URL, the true original is preserved
// but unreachable, and .gif/undecodable uploads pass through unprocessed.
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
    // in the real dev uploads directory (there's no per-test override of
    // uploadsDir — routes/uploads.ts resolves it from process.cwd()).
    for (const uuid of writtenUuids.splice(0)) {
      const entries = await fsp.readdir(uploadsDir).catch(() => [] as string[]);
      await Promise.all(
        entries.filter((f) => f.startsWith(uuid)).map((f) => fsp.unlink(path.join(uploadsDir, f)).catch(() => {}))
      );
      await fsp.unlink(path.join(uploadsDir, 'originals', `${uuid}.jpg`)).catch(() => {});
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
    const originalOnDisk = await sharp(path.join(uploadsDir, 'originals', `${uuid}.jpg`)).metadata();
    expect(originalOnDisk.width).toBe(3000);
    const originalsRes = await app.inject({
      method: 'GET',
      url: `/uploads/originals/${uuid}.jpg`,
      headers: authHeader(member),
    });
    expect(originalsRes.statusCode).toBe(404);
  });

  it('falls back to storing the raw upload unprocessed when sharp cannot decode it', async () => {
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
    expect(urls[0]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.heic$/);
    const uuid = urls[0].match(/\/uploads\/([0-9a-f-]{36})\.heic$/)![1];
    writtenUuids.push(uuid);

    const res = await app.inject({ method: 'GET', url: urls[0], headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(garbage)).toBe(true);

    // Nothing should be left stranded in originals/ (unreachable forever) —
    // the file is moved back out to the plain, servable path on fallback.
    await expect(fsp.access(path.join(uploadsDir, 'originals', `${uuid}.heic`))).rejects.toThrow();
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

  it('processes multiple files from one request with matching per-file output, in the same order', async () => {
    const member = await createUser();

    const photoA = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    const photoB = await sharp({
      create: { width: 2200, height: 1400, channels: 3, background: { r: 40, g: 40, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .gif()
      .toBuffer();

    const { body, contentType } = buildMultiFileMultipartBody([
      { filename: 'a.jpg', contentType: 'image/jpeg', data: photoA },
      { filename: 'b.jpg', contentType: 'image/jpeg', data: photoB },
      { filename: 'c.gif', contentType: 'image/gif', data: gif },
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const { urls } = uploadRes.json();
    expect(urls).toHaveLength(3);

    // Same order as the parts were uploaded in: jpg, jpg, gif.
    expect(urls[0]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    expect(urls[1]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    expect(urls[2]).toMatch(/^\/uploads\/[0-9a-f-]{36}\.gif$/);

    const uuidA = urls[0].match(/\/uploads\/([0-9a-f-]{36})\.jpg$/)![1];
    const uuidB = urls[1].match(/\/uploads\/([0-9a-f-]{36})\.jpg$/)![1];
    const uuidGif = urls[2].match(/\/uploads\/([0-9a-f-]{36})\.gif$/)![1];
    writtenUuids.push(uuidA, uuidB, uuidGif);

    // Each JPEG got its own resized display copy and 400px thumbnail.
    for (const [url, uuid] of [
      [urls[0], uuidA],
      [urls[1], uuidB],
    ] as const) {
      const displayRes = await app.inject({ method: 'GET', url, headers: authHeader(member) });
      expect(displayRes.statusCode).toBe(200);
      const displayMeta = await sharp(displayRes.rawPayload).metadata();
      expect(displayMeta.format).toBe('jpeg');
      expect(displayMeta.width).toBe(1920);

      const thumbRes = await app.inject({
        method: 'GET',
        url: `/uploads/${uuid}-thumbnail.jpg`,
        headers: authHeader(member),
      });
      expect(thumbRes.statusCode).toBe(200);
      const thumbMeta = await sharp(thumbRes.rawPayload).metadata();
      expect(thumbMeta.format).toBe('jpeg');
      expect(thumbMeta.width).toBe(400);
    }

    // The gif passed through byte-identical, unprocessed.
    const gifRes = await app.inject({ method: 'GET', url: urls[2], headers: authHeader(member) });
    expect(gifRes.statusCode).toBe(200);
    expect(gifRes.rawPayload.equals(gif)).toBe(true);
  });
});
