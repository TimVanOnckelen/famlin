import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader } from './helpers.js';

const uploadsDir = path.join(process.cwd(), 'uploads');

function buildMultipartBody(filename: string, contentType: string, data: Buffer) {
  const boundary = '----FamlinGuardBoundary';
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

/**
 * The /uploads/ auth hook (app.ts) decides whether a request touches family
 * media by inspecting the request path. It has to compare against the
 * NORMALIZED path, because that is what @fastify/static resolves — guarding
 * on the raw URL lets a non-canonical spelling skip the hook entirely and
 * still be served.
 *
 * These assert only that the file is not served (`not.toBe(200)`), rather
 * than a specific status: whether a given spelling is rejected by the router
 * (404) or by our hook (401) is find-my-way's business and may change. The
 * security property is "unauthenticated request never receives the bytes".
 */
describe('/uploads/ auth guard — non-canonical paths', () => {
  let app: FastifyInstance;
  let uuid: string;
  let filename: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const uploader = await createUser();
    const image = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const { body, contentType } = buildMultipartBody('guard.jpg', 'image/jpeg', image);
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(uploader), 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const url: string = res.json().urls[0];
    uuid = url.match(/\/uploads\/([0-9a-f-]{36})\.jpg$/)![1];
    filename = `${uuid}.jpg`;
  });

  afterAll(async () => {
    const entries = await fsp.readdir(uploadsDir).catch(() => [] as string[]);
    await Promise.all(
      entries.filter((f) => f.startsWith(uuid)).map((f) => fsp.unlink(path.join(uploadsDir, f)).catch(() => {}))
    );
    await fsp.unlink(path.join(uploadsDir, 'originals', `${uuid}.jpg`)).catch(() => {});
    await app.close();
  });

  it('rejects the plain path without a token (baseline)', async () => {
    const res = await app.inject({ method: 'GET', url: `/uploads/${filename}` });
    expect(res.statusCode).toBe(401);
  });

  it('serves the plain path with a token (baseline)', async () => {
    const member = await createUser();
    const res = await app.inject({ method: 'GET', url: `/uploads/${filename}`, headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['duplicate leading slash', () => `//uploads/${filename}`],
    ['single-dot segment', () => `/./uploads/${filename}`],
    ['dot-dot re-entry', () => `/anything/../uploads/${filename}`],
    ['percent-encoded separator', () => `/uploads%2F${filename}`],
  ])('does not serve family media unauthenticated via %s', async (_label, makeUrl) => {
    const res = await app.inject({ method: 'GET', url: makeUrl() });
    expect(res.statusCode).not.toBe(200);
  });

  it('never serves uploads/originals/, even to an authenticated member', async () => {
    const member = await createUser();
    for (const url of [`/uploads/originals/${uuid}.jpg`, `/uploads/x/../originals/${uuid}.jpg`]) {
      const res = await app.inject({ method: 'GET', url, headers: authHeader(member) });
      expect(res.statusCode).not.toBe(200);
    }
  });
});
