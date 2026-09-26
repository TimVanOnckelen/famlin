import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { RESTORED_TOKEN_VERSION, isNewerVersion } from '../src/services/import.js';
import pkg from '../package.json' with { type: 'json' };
import {
  buildTestApp,
  createUser,
  createGroupWithMember,
  addMember,
  createPost,
  createComment,
  authHeader,
} from './helpers.js';

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

function multipartBody(fields: Record<string, string>, archive?: Buffer) {
  const boundary = `----famlin${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (archive) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="backup.zip"\r\nContent-Type: application/zip\r\n\r\n`
      ),
      archive,
      Buffer.from('\r\n')
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const archive = new ZipArchive({ store: true });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

const adminFields = { email: 'restorer@example.com', name: 'Restorer', password: 'restored-password-1' };

describe('POST /api/auth/setup/restore', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // The route is rate-limited per IP (5 per 15 minutes); give each call its
  // own address so the suite never trips it.
  let calls = 0;
  function restore(fields: Record<string, string>, archive?: Buffer) {
    const { payload, headers } = multipartBody(fields, archive);
    calls += 1;
    return app.inject({
      method: 'POST',
      url: '/api/auth/setup/restore',
      payload,
      headers,
      remoteAddress: `10.0.0.${calls}`,
    });
  }

  it('round-trips an export: seed, export, wipe, restore, compare', async () => {
    // --- seed ---------------------------------------------------------
    const admin = await createUser({ isAdmin: true, email: 'admin@example.com', name: 'Admin', password: 'old-password-1' });
    const member = await createUser({ email: 'member@example.com', name: 'Member', password: 'member-password' });
    const group = await createGroupWithMember(admin);
    await addMember(group.id, member.id);
    await prisma.group.update({ where: { id: group.id }, data: { chitchatEnabled: true, allowedPostTypes: ['UPDATE', 'POLL'] } });

    const circle = await prisma.circle.create({
      data: { groupId: group.id, name: 'Grandparents', createdById: admin.id, members: { create: [{ userId: admin.id }] } },
    });

    const assetKey = crypto.randomUUID();
    const assetPath = `/uploads/${assetKey}.jpg`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, `${assetKey}.jpg`), 'fake-jpeg-bytes');
    fs.mkdirSync(path.join(uploadsDir, 'originals'), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, 'originals', `${assetKey}.png`), 'fake-original-bytes');
    await prisma.upload.create({ data: { assetKey, uploaderId: admin.id, circleId: circle.id, bound: true } });

    const circlePost = await prisma.post.create({
      data: { groupId: group.id, authorId: admin.id, circleId: circle.id, content: 'Circle only', uploadedAssetUrls: [assetPath] },
    });
    const poll = await prisma.post.create({
      data: {
        groupId: group.id,
        authorId: member.id,
        type: 'POLL',
        content: 'Pizza?',
        typeData: { options: [{ id: 'a', text: 'Yes' }, { id: 'b', text: 'No' }], closesAt: null },
        uploadedAssetUrls: [],
      },
    });
    await prisma.postInteraction.create({ data: { postId: poll.id, userId: admin.id, key: 'vote', value: { optionId: 'a' } } });
    const plain = await createPost({ groupId: group.id, authorId: member.id, content: 'Hello' });

    const parent = await createComment({ postId: plain.id, authorId: admin.id, content: 'Parent' });
    const reply = await createComment({ postId: plain.id, authorId: member.id, content: 'Reply', parentId: parent.id });
    await prisma.comment.update({ where: { id: reply.id }, data: { metadata: { kind: 'test' } } });
    await prisma.like.create({ data: { postId: plain.id, userId: admin.id, type: 'LOVE' } });
    await prisma.like.create({ data: { commentId: parent.id, userId: member.id } });
    await prisma.favorite.create({ data: { postId: plain.id, userId: admin.id } });

    const msg = await prisma.chatMessage.create({ data: { groupId: group.id, authorId: admin.id, content: 'Hi' } });
    await prisma.chatMessage.create({ data: { groupId: group.id, authorId: member.id, content: 'Hey', replyToMessageId: msg.id } });
    await prisma.chatMessage.create({
      data: { groupId: group.id, authorId: member.id, kind: 'SYSTEM_MILESTONE', refPostId: plain.id },
    });
    await prisma.chatRead.create({ data: { groupId: group.id, userId: admin.id } });
    await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: 'local', externalAlbumId: 'summer', albumName: 'Summer', newAssetMode: 'MANUAL' },
    });
    await prisma.mediaPersonLink.create({
      data: { provider: 'immich', externalPersonId: 'p1', label: 'Grandma', userId: member.id },
    });

    // Stories: a pinned Highlight (restored, with its reaction) and a live
    // story (deliberately not exported — nor are views or private replies).
    await prisma.group.update({ where: { id: group.id }, data: { storiesEnabled: false } });
    await prisma.user.update({ where: { id: member.id }, data: { pushOnStory: true } });
    const highlightKey = crypto.randomUUID();
    const liveKey = crypto.randomUUID();
    fs.writeFileSync(path.join(uploadsDir, `${highlightKey}.jpg`), 'highlight-bytes');
    fs.writeFileSync(path.join(uploadsDir, `${liveKey}.jpg`), 'live-bytes');
    await prisma.upload.create({ data: { assetKey: highlightKey, uploaderId: admin.id, bound: true } });
    await prisma.upload.create({ data: { assetKey: liveKey, uploaderId: member.id, bound: true } });
    const createdAt = new Date('2026-07-01T10:00:00Z');
    const highlight = await prisma.story.create({
      data: {
        authorId: admin.id,
        groupId: group.id,
        imageUrl: `/uploads/${highlightKey}.jpg`,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
        pinnedAt: new Date('2026-07-01T11:00:00Z'),
      },
    });
    await prisma.storyReaction.create({ data: { storyId: highlight.id, userId: member.id, type: 'WOW' } });
    await prisma.storyView.create({ data: { storyId: highlight.id, userId: member.id } });
    await prisma.storyReply.create({ data: { storyId: highlight.id, fromUserId: member.id, content: 'private' } });
    await prisma.story.create({
      data: {
        authorId: member.id,
        groupId: group.id,
        imageUrl: `/uploads/${liveKey}.jpg`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // --- snapshot + export --------------------------------------------
    const snapshot = async () => ({
      users: await prisma.user.findMany({
        orderBy: { id: 'asc' },
        omit: { passwordHash: true, tokenVersion: true },
      }),
      groups: await prisma.group.findMany({ orderBy: { id: 'asc' } }),
      groupMembers: await prisma.groupMember.findMany({ orderBy: { id: 'asc' } }),
      circles: await prisma.circle.findMany({ orderBy: { id: 'asc' } }),
      circleMembers: await prisma.circleMember.findMany({ orderBy: { id: 'asc' } }),
      posts: await prisma.post.findMany({ orderBy: { id: 'asc' } }),
      postInteractions: await prisma.postInteraction.findMany({ orderBy: { id: 'asc' } }),
      comments: await prisma.comment.findMany({ orderBy: { id: 'asc' } }),
      likes: await prisma.like.findMany({ orderBy: { id: 'asc' } }),
      favorites: await prisma.favorite.findMany({ orderBy: { id: 'asc' } }),
      chatMessages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
      chatReads: await prisma.chatRead.findMany({ orderBy: { id: 'asc' } }),
      mediaAlbumLinks: await prisma.mediaAlbumLink.findMany({ orderBy: { id: 'asc' } }),
      mediaPersonLinks: await prisma.mediaPersonLink.findMany({ orderBy: { id: 'asc' } }),
      // The live story's Upload row is left out of the export with its photo.
      uploads: await prisma.upload.findMany({ where: { assetKey: { not: liveKey } }, orderBy: { id: 'asc' } }),
      stories: await prisma.story.findMany({ where: { pinnedAt: { not: null } }, orderBy: { id: 'asc' } }),
      storyReactions: await prisma.storyReaction.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();

    const exportRes = await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) });
    expect(exportRes.statusCode).toBe(200);
    const archive = exportRes.rawPayload;

    // --- wipe ---------------------------------------------------------
    await truncateAll();
    fs.rmSync(path.join(uploadsDir, `${assetKey}.jpg`));
    fs.rmSync(path.join(uploadsDir, 'originals', `${assetKey}.png`));
    fs.rmSync(path.join(uploadsDir, `${highlightKey}.jpg`));
    fs.rmSync(path.join(uploadsDir, `${liveKey}.jpg`));

    // --- restore, as the admin whose account is in the backup -----------
    const res = await restore({ email: 'Admin@Example.com', name: 'Ignored', password: 'new-password-1' }, archive);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe(admin.id);
    expect(body.user.isAdmin).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.counts).toMatchObject({
      users: 2,
      groups: 1,
      groupMembers: 2,
      circles: 1,
      circleMembers: 1,
      posts: 3,
      postInteractions: 1,
      comments: 2,
      reactions: 2,
      favorites: 1,
      chatMessages: 3,
      chatReads: 1,
      mediaAlbumLinks: 1,
      mediaPersonLinks: 1,
      uploads: 2,
      highlights: 1,
    });

    const after = await snapshot();
    expect(after).toEqual(before);

    // Files are back under their original paths.
    expect(fs.readFileSync(path.join(uploadsDir, `${assetKey}.jpg`), 'utf8')).toBe('fake-jpeg-bytes');
    expect(fs.readFileSync(path.join(uploadsDir, 'originals', `${assetKey}.png`), 'utf8')).toBe('fake-original-bytes');
    expect(fs.readFileSync(path.join(uploadsDir, `${highlightKey}.jpg`), 'utf8')).toBe('highlight-bytes');
    // A live story, its photo, and every view/private reply stay out of a restore.
    expect(fs.existsSync(path.join(uploadsDir, `${liveKey}.jpg`))).toBe(false);
    expect(await prisma.story.count({ where: { pinnedAt: null } })).toBe(0);
    expect(await prisma.storyView.count()).toBe(0);
    expect(await prisma.storyReply.count()).toBe(0);
    // ...and no scratch directory is left behind.
    expect(fs.readdirSync(uploadsDir).filter((n) => n.startsWith('.restore-'))).toEqual([]);

    // The restorer logs in with the password they just chose; the other
    // restored member has no password at all.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'new-password-1' },
    });
    expect(login.statusCode).toBe(200);
    const restoredMember = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(restoredMember.passwordHash).toBeNull();
    expect(restoredMember.tokenVersion).toBe(RESTORED_TOKEN_VERSION);

    // A token issued before the restore no longer authenticates.
    const stale = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(member) });
    expect(stale.statusCode).toBe(401);

    // The restored circle still narrows the audience: the member isn't in it.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${body.token}` } });
    expect(me.statusCode).toBe(200);
    const memberFeed = await app.inject({
      method: 'GET',
      url: `/api/posts/${circlePost.id}`,
      headers: authHeader({ ...member, tokenVersion: RESTORED_TOKEN_VERSION }),
    });
    expect(memberFeed.statusCode).toBe(404);
  });

  it('creates a separate admin account when the email is not in the backup', async () => {
    const admin = await createUser({ isAdmin: true, email: 'someone@example.com' });
    await createGroupWithMember(admin);
    const archive = (await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) })).rawPayload;
    await truncateAll();

    const res = await restore(adminFields, archive);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('restorer@example.com');
    expect(await prisma.user.count()).toBe(2);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(restored.isAdmin).toBe(true);
    expect(restored.passwordHash).toBeNull();
  });

  it('409s once the instance has any user, and writes nothing', async () => {
    const admin = await createUser({ isAdmin: true });
    const archive = (await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) })).rawPayload;

    const res = await restore(adminFields, archive);
    expect(res.statusCode).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });

  it('400s without an archive', async () => {
    const res = await restore(adminFields);
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('400s for a file that is not a zip', async () => {
    const res = await restore(adminFields, Buffer.from('definitely not a zip file'));
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('400s for a zip that is not a Famlin export', async () => {
    const res = await restore(adminFields, await zipOf({ 'hello.txt': 'hi' }));
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses an archive from a newer server version', async () => {
    const archive = await zipOf({
      'manifest.json': JSON.stringify({ serverVersion: '999.0.0' }),
      'data/users.json': '[]',
      'data/groups.json': '[]',
    });
    const res = await restore(adminFields, archive);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/newer version/);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rolls back everything when the archive references missing rows', async () => {
    const archive = await zipOf({
      'manifest.json': JSON.stringify({ serverVersion: pkg.version }),
      'data/users.json': '[]',
      'data/groups.json': '[]',
      'data/posts.json': JSON.stringify([
        { id: 'p1', authorId: 'nobody', groupId: 'nowhere', createdAt: new Date().toISOString(), uploadedAssetUrls: [] },
      ]),
    });
    const res = await restore(adminFields, archive);
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('skips restore scratch directories that ended up inside an archive', async () => {
    const archive = await zipOf({
      'manifest.json': JSON.stringify({ serverVersion: pkg.version }),
      'data/users.json': '[]',
      'data/groups.json': '[]',
      'uploads/.restore-evil/x.jpg': 'nope',
    });
    const res = await restore(adminFields, archive);
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(uploadsDir, '.restore-evil'))).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it('compares semver triples', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.7.1', '0.7.0')).toBe(true);
    expect(isNewerVersion('0.7.0', '0.7.0')).toBe(false);
    expect(isNewerVersion('0.6.12', '0.7.0')).toBe(false);
  });
});
