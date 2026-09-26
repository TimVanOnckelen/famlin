import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { collectUploadKeys } from '../src/services/memberExport.js';
import {
  buildTestApp,
  createUser,
  createGroupWithMember,
  addMember,
  createPost,
  createComment,
  authHeader,
} from './helpers.js';

// Store-mode zip: JSON entries and file names aren't deflated, so their bytes
// appear verbatim in the raw archive body — same technique as export.test.ts.
async function exportBody(app: FastifyInstance, user: Parameters<typeof authHeader>[0]) {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(user) });
  expect(res.statusCode).toBe(200);
  return res.rawPayload.toString('latin1');
}

describe('GET /api/auth/me/export', () => {
  let app: FastifyInstance;
  const createdFiles: string[] = [];

  async function writeUpload(rel: string) {
    const full = path.join(uploadsDir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, `fixture:${rel}`);
    createdFiles.push(full);
  }

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await Promise.all(createdFiles.map((f) => fsp.unlink(f).catch(() => {})));
    await app.close();
  });

  it('401s when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me/export' });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits per user, not per IP', async () => {
    const heavy = await createUser();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(heavy) });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);

    // Another member from the same address still has their own budget.
    const other = await createUser();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(other) });
    expect(res.statusCode).toBe(200);
  });

  it('returns a zip for any member, not just admins', async () => {
    const member = await createUser();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it("includes the caller's groups' content (other members' too) but never another group's", async () => {
    const me = await createUser({ name: 'Exporting Member' });
    const relative = await createUser({ name: 'Fellow Member' });
    const stranger = await createUser({ name: 'Stranger In Another Family' });

    const myGroup = await createGroupWithMember(me, { name: 'My Family Group' });
    await addMember(myGroup.id, relative.id);
    const otherGroup = await createGroupWithMember(stranger, { name: 'Somebody Else Group' });

    const relativePost = await createPost({
      groupId: myGroup.id,
      authorId: relative.id,
      content: 'Relative post that belongs in my export',
    });
    await createComment({ postId: relativePost.id, authorId: relative.id, content: 'Comment in my family' });
    await prisma.like.create({ data: { postId: relativePost.id, userId: relative.id, type: 'LOVE' } });

    const otherPost = await createPost({
      groupId: otherGroup.id,
      authorId: stranger.id,
      content: 'Secret post from another family',
    });
    await createComment({ postId: otherPost.id, authorId: stranger.id, content: 'Secret comment elsewhere' });

    const body = await exportBody(app, me);

    expect(body).toContain('manifest.json');
    expect(body).toContain('Relative post that belongs in my export');
    expect(body).toContain('Comment in my family');
    expect(body).toContain('My Family Group');
    expect(body).toContain(relative.email);

    expect(body).not.toContain('Secret post from another family');
    expect(body).not.toContain('Secret comment elsewhere');
    expect(body).not.toContain('Somebody Else Group');
    expect(body).not.toContain(stranger.email);
    expect(body).not.toContain(otherPost.id);
  });

  it("excludes circle-private posts in circles the caller isn't in", async () => {
    const me = await createUser();
    const insider = await createUser();
    const group = await createGroupWithMember(me);
    await addMember(group.id, insider.id);

    const hiddenCircle = await prisma.circle.create({
      data: { groupId: group.id, name: 'Hidden circle', members: { create: [{ userId: insider.id }] } },
    });
    const myCircle = await prisma.circle.create({
      data: { groupId: group.id, name: 'My circle', members: { create: [{ userId: me.id }] } },
    });

    await prisma.post.create({
      data: { groupId: group.id, authorId: insider.id, content: 'Circle secret I cannot see', circleId: hiddenCircle.id },
    });
    await prisma.post.create({
      data: { groupId: group.id, authorId: me.id, content: 'Circle post I can see', circleId: myCircle.id },
    });

    const body = await exportBody(app, me);
    expect(body).toContain('Circle post I can see');
    expect(body).not.toContain('Circle secret I cannot see');
  });

  it('attaches only upload files referenced by visible content', async () => {
    const me = await createUser();
    const stranger = await createUser();
    const myGroup = await createGroupWithMember(me);
    const otherGroup = await createGroupWithMember(stranger);

    const mine = crypto.randomUUID();
    const commentPhoto = crypto.randomUUID();
    const theirs = crypto.randomUUID();
    await writeUpload(`${mine}.jpg`);
    await writeUpload(`${mine}-thumbnail.jpg`);
    await writeUpload(`originals/${mine}.heic`);
    await writeUpload(`${commentPhoto}.jpg`);
    await writeUpload(`${theirs}.jpg`);

    const post = await createPost({ groupId: myGroup.id, authorId: me.id, uploadedAssetUrls: [`/uploads/${mine}.jpg`] });
    await createComment({ postId: post.id, authorId: me.id, attachmentUrl: `/uploads/${commentPhoto}.jpg` });
    await createPost({ groupId: otherGroup.id, authorId: stranger.id, uploadedAssetUrls: [`/uploads/${theirs}.jpg`] });

    const body = await exportBody(app, me);
    expect(body).toContain(`uploads/${mine}.jpg`);
    expect(body).toContain(`uploads/${mine}-thumbnail.jpg`);
    expect(body).toContain(`uploads/originals/${mine}.heic`);
    expect(body).toContain(`uploads/${commentPhoto}.jpg`);
    expect(body).not.toContain(theirs);
  });

  it('never includes credentials, invites, or other members\' private data', async () => {
    const me = await createUser({ password: 'my-own-password' });
    const relative = await createUser({ password: 'relative-password' });
    const group = await createGroupWithMember(me);
    await addMember(group.id, relative.id);
    const post = await createPost({ groupId: group.id, authorId: relative.id });
    const theirFavorite = await prisma.favorite.create({ data: { postId: post.id, userId: relative.id } });
    const myFavorite = await prisma.favorite.create({ data: { postId: post.id, userId: me.id } });
    const invite = await prisma.invite.create({
      data: { groupId: group.id, token: `invite-${crypto.randomUUID()}`, createdById: me.id },
    });

    const body = await exportBody(app, me);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('tokenVersion');
    expect(body).not.toContain(invite.token);
    expect(body).not.toContain('crossPostId');
    // A relative's favorites are private bookmarks; only mine are exported.
    expect(body).toContain(myFavorite.id);
    expect(body).not.toContain(theirFavorite.id);
  });
});

describe('collectUploadKeys', () => {
  it('maps every rendition path to its upload key', () => {
    const keys = collectUploadKeys(
      JSON.stringify({ a: '/uploads/abc.jpg', b: ['/uploads/abc-thumbnail.jpg', '/uploads/def.mp4'], c: '/api/media/x' })
    );
    expect([...keys].sort()).toEqual(['abc', 'def']);
  });
});
