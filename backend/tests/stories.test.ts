import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { uploadAssetKey } from '../src/services/uploads.js';
import { runExpireStoriesJob } from '../src/jobs/expireStories.js';

type TestUser = Awaited<ReturnType<typeof createUser>>;

function multipart(filename: string, data: Buffer) {
  const boundary = '----FamlinStoriesBoundary';
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
let author: TestUser;
let viewer: TestUser;
let insider: TestUser;
let outsider: TestUser;
let admin: TestUser;
let family: Awaited<ReturnType<typeof createGroup>>;
let other: Awaited<ReturnType<typeof createGroup>>;
let circle: { id: string };
const createdKeys: string[] = [];

async function upload(user: TestUser): Promise<string> {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
  const { body, contentType } = multipart('story.jpg', image);
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

async function createStory(user: TestUser, payload: Record<string, unknown>) {
  const imageUrl = await upload(user);
  return app.inject({
    method: 'POST',
    url: '/api/stories',
    headers: authHeader(user),
    payload: { imageUrl, ...payload },
  });
}

async function expire(storyId: string) {
  const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  await prisma.story.updateMany({
    where: story.crossStoryId ? { crossStoryId: story.crossStoryId } : { id: storyId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
}

function trayStoryIds(res: { json: () => any }): string[] {
  return res.json().authors.flatMap((a: any) => a.stories.map((s: any) => s.id));
}

beforeAll(async () => {
  app = await buildTestApp();

  author = await createUser({ name: 'Story Author' });
  viewer = await createUser({ name: 'Story Viewer' });
  insider = await createUser({ name: 'Circle Insider' });
  outsider = await createUser({ name: 'Not In Family' });
  admin = await createUser({ name: 'Story Admin', isAdmin: true });

  family = await createGroup({ name: 'Story Family' });
  other = await createGroup({ name: 'Other Family' });
  for (const u of [author, viewer, insider, admin]) await addMember(family.id, u.id);
  for (const u of [author, viewer]) await addMember(other.id, u.id);

  circle = await prisma.circle.create({
    data: {
      groupId: family.id,
      name: 'Inner circle',
      members: { create: [{ userId: author.id }, { userId: insider.id }] },
    },
  });
});

afterAll(async () => {
  for (const dir of [uploadsDir, path.join(uploadsDir, 'originals')]) {
    const entries = await fsp.readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((f) => createdKeys.some((key) => f.startsWith(key)))
        .map((f) => fsp.unlink(path.join(dir, f)).catch(() => {}))
    );
  }
  await app.close();
});

describe('POST /api/stories', () => {
  it('creates a live story for a group member', async () => {
    const res = await createStory(author, { groupId: family.id });
    expect(res.statusCode).toBe(200);
    const story = res.json();
    expect(story.isMine).toBe(true);
    expect(story.expired).toBe(false);
    expect(story.stats).toEqual({ viewCount: 0, reactionCount: 0, replyCount: 0 });
    const lifetime = new Date(story.expiresAt).getTime() - new Date(story.createdAt).getTime();
    expect(lifetime).toBe(24 * 60 * 60 * 1000);
  });

  it('403s for a group the author is not in', async () => {
    const res = await createStory(outsider, { groupId: family.id });
    expect(res.statusCode).toBe(403);
  });

  it('403s when the group has stories turned off, and a cross-post creates nothing', async () => {
    const disabled = await createGroup({ name: 'No stories here' });
    await prisma.group.update({ where: { id: disabled.id }, data: { storiesEnabled: false } });
    await addMember(disabled.id, author.id);

    const before = await prisma.story.count();
    const res = await createStory(author, { groupIds: [family.id, disabled.id] });
    expect(res.statusCode).toBe(403);
    expect(await prisma.story.count()).toBe(before);
  });

  it("rejects someone else's upload, an already-used upload, and a video", async () => {
    const viewersPhoto = await upload(viewer);
    const stolen = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: authHeader(author),
      payload: { imageUrl: viewersPhoto, groupId: family.id },
    });
    expect(stolen.statusCode).toBe(400);

    const first = await createStory(author, { groupId: family.id });
    const reused = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: authHeader(author),
      payload: { imageUrl: first.json().imageUrl, groupId: family.id },
    });
    expect(reused.statusCode).toBe(400);

    const video = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: authHeader(author),
      payload: { imageUrl: '/uploads/11111111-2222-3333-4444-555555555555.mp4', groupId: family.id },
    });
    expect(video.statusCode).toBe(400);
  });

  it('rejects a circle combined with cross-posting, and a circle the author is not in', async () => {
    const combined = await createStory(author, { groupIds: [family.id, other.id], circleId: circle.id });
    expect(combined.statusCode).toBe(400);

    const notMine = await createStory(viewer, { groupId: family.id, circleId: circle.id });
    expect(notMine.statusCode).toBe(403);
  });
});

describe('visibility', () => {
  it('shows a story in the tray to group members only', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();

    const asViewer = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(viewer) });
    expect(trayStoryIds(asViewer)).toContain(story.id);

    const asOutsider = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(outsider) });
    expect(trayStoryIds(asOutsider)).not.toContain(story.id);

    const probe = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: authHeader(outsider) });
    expect(probe.statusCode).toBe(404);

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/stories?groupIds=${family.id}`,
      headers: authHeader(outsider),
    });
    expect(filtered.statusCode).toBe(403);
  });

  it('keeps a circle story, and its photo, away from group members outside the circle', async () => {
    const story = (await createStory(author, { groupId: family.id, circleId: circle.id })).json();

    const asInsider = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(insider) });
    expect(trayStoryIds(asInsider)).toContain(story.id);

    const asViewer = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(viewer) });
    expect(trayStoryIds(asViewer)).not.toContain(story.id);
    const probe = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: authHeader(viewer) });
    expect(probe.statusCode).toBe(404);

    const photoAsViewer = await app.inject({ method: 'GET', url: story.imageUrl, headers: authHeader(viewer) });
    expect(photoAsViewer.statusCode).toBe(404);
    const photoAsInsider = await app.inject({ method: 'GET', url: story.imageUrl, headers: authHeader(insider) });
    expect(photoAsInsider.statusCode).toBe(200);
  });

  it('shows a cross-posted story once to a member of both groups, and lists its groups to the author only', async () => {
    const story = (await createStory(author, { groupIds: [family.id, other.id] })).json();
    expect(story.sharedWithGroups.map((g: any) => g.id).sort()).toEqual([family.id, other.id].sort());

    const asViewer = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(viewer) });
    const viewerCopies = asViewer
      .json()
      .authors.flatMap((a: any) => a.stories)
      .filter((s: any) => s.imageUrl === story.imageUrl);
    expect(viewerCopies).toHaveLength(1);
    expect(viewerCopies[0].sharedWithGroups).toBeUndefined();
    expect(viewerCopies[0].stats).toBeNull();
  });

  it('hides stories while the group has them turned off', async () => {
    const group = await createGroup({ name: 'Toggle family' });
    await addMember(group.id, author.id);
    await addMember(group.id, viewer.id);
    const story = (await createStory(author, { groupId: group.id })).json();

    await prisma.group.update({ where: { id: group.id }, data: { storiesEnabled: false } });
    const res = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(viewer) });
    expect(trayStoryIds(res)).not.toContain(story.id);
  });

  it('orders the tray: own stories first, then unseen authors', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories', headers: authHeader(author) });
    expect(res.json().authors[0].author.id).toBe(author.id);
  });
});

describe('views, reactions and replies', () => {
  it('records "seen by" for viewers only, visible to the author only', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();

    await app.inject({ method: 'POST', url: `/api/stories/${story.id}/view`, headers: authHeader(author) });
    const view = await app.inject({ method: 'POST', url: `/api/stories/${story.id}/view`, headers: authHeader(viewer) });
    expect(view.statusCode).toBe(200);
    // Idempotent.
    await app.inject({ method: 'POST', url: `/api/stories/${story.id}/view`, headers: authHeader(viewer) });

    const views = await app.inject({ method: 'GET', url: `/api/stories/${story.id}/views`, headers: authHeader(author) });
    expect(views.json().items.map((v: any) => v.id)).toEqual([viewer.id]);

    const snooping = await app.inject({ method: 'GET', url: `/api/stories/${story.id}/views`, headers: authHeader(viewer) });
    expect(snooping.statusCode).toBe(404);

    const seen = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: authHeader(viewer) });
    expect(seen.json().seen).toBe(true);
  });

  it('toggles and switches a reaction', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();
    const react = (type: string) =>
      app.inject({ method: 'POST', url: `/api/stories/${story.id}/reaction`, headers: authHeader(viewer), payload: { type } });

    expect((await react('LOVE')).json().myReaction).toBe('LOVE');
    expect((await react('HAHA')).json().myReaction).toBe('HAHA');
    expect(await prisma.storyReaction.count({ where: { storyId: story.id } })).toBe(1);

    const list = await app.inject({ method: 'GET', url: `/api/stories/${story.id}/reactions`, headers: authHeader(author) });
    expect(list.json().items).toEqual([expect.objectContaining({ id: viewer.id, type: 'HAHA' })]);

    expect((await react('HAHA')).json().myReaction).toBeNull();
    expect(await prisma.storyReaction.count({ where: { storyId: story.id } })).toBe(0);
  });

  it('allows one private reply per viewer, never to yourself, and only while live', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();
    const replyAs = (user: TestUser, content = 'Lovely!') =>
      app.inject({ method: 'POST', url: `/api/stories/${story.id}/reply`, headers: authHeader(user), payload: { content } });

    expect((await replyAs(viewer)).statusCode).toBe(200);
    expect((await replyAs(viewer, 'Again')).statusCode).toBe(409);
    expect((await replyAs(author)).statusCode).toBe(400);

    const asAuthor = await app.inject({ method: 'GET', url: `/api/stories/${story.id}/replies`, headers: authHeader(author) });
    expect(asAuthor.json().items).toEqual([expect.objectContaining({ content: 'Lovely!' })]);

    for (const user of [viewer, insider, admin]) {
      const res = await app.inject({ method: 'GET', url: `/api/stories/${story.id}/replies`, headers: authHeader(user) });
      expect(res.statusCode).toBe(404);
    }

    const mine = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: authHeader(viewer) });
    expect(mine.json().myReply.content).toBe('Lovely!');

    await app.inject({ method: 'POST', url: `/api/stories/${story.id}/pin`, headers: authHeader(author) });
    await expire(story.id);
    expect((await replyAs(insider)).statusCode).toBe(400);
  });
});

describe('pinning, Highlights and expiry', () => {
  it('only the author can pin, only while live, and a pinned story becomes a Highlight', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();

    const byViewer = await app.inject({ method: 'POST', url: `/api/stories/${story.id}/pin`, headers: authHeader(viewer) });
    expect(byViewer.statusCode).toBe(404);

    const pin = await app.inject({ method: 'POST', url: `/api/stories/${story.id}/pin`, headers: authHeader(author) });
    expect(pin.statusCode).toBe(200);

    const highlights = await app.inject({ method: 'GET', url: '/api/stories/highlights', headers: authHeader(viewer) });
    expect(highlights.json().items.map((s: any) => s.id)).toContain(story.id);

    const late = (await createStory(author, { groupId: family.id })).json();
    await expire(late.id);
    const latePin = await app.inject({ method: 'POST', url: `/api/stories/${late.id}/pin`, headers: authHeader(author) });
    expect(latePin.statusCode).toBe(404);
  });

  it('orders Highlights by story date, newest first, as one flat list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/highlights', headers: authHeader(viewer) });
    const dates = res.json().items.map((s: any) => new Date(s.createdAt).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('expiry deletes an unpinned story and its files, keeps a pinned one with a frozen seen-by list', async () => {
    const doomed = (await createStory(author, { groupId: family.id })).json();
    const kept = (await createStory(author, { groupId: family.id })).json();
    await app.inject({ method: 'POST', url: `/api/stories/${kept.id}/view`, headers: authHeader(viewer) });
    await app.inject({ method: 'POST', url: `/api/stories/${kept.id}/pin`, headers: authHeader(author) });
    await app.inject({
      method: 'POST',
      url: `/api/stories/${doomed.id}/reply`,
      headers: authHeader(viewer),
      payload: { content: 'bye' },
    });

    const doomedFile = path.join(uploadsDir, path.basename(doomed.imageUrl));
    expect(fs.existsSync(doomedFile)).toBe(true);

    await expire(doomed.id);
    await expire(kept.id);

    // Hidden immediately, before the job even runs.
    const gone = await app.inject({ method: 'GET', url: `/api/stories/${doomed.id}`, headers: authHeader(viewer) });
    expect(gone.statusCode).toBe(404);

    await runExpireStoriesJob();

    expect(await prisma.story.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await prisma.storyReply.count({ where: { storyId: doomed.id } })).toBe(0);
    expect(fs.existsSync(doomedFile)).toBe(false);
    expect(
      await prisma.upload.findUnique({ where: { assetKey: uploadAssetKey(doomed.imageUrl) } })
    ).toBeNull();

    // A view after expiry is ignored: the list is frozen.
    await app.inject({ method: 'POST', url: `/api/stories/${kept.id}/view`, headers: authHeader(insider) });
    const views = await app.inject({ method: 'GET', url: `/api/stories/${kept.id}/views`, headers: authHeader(author) });
    expect(views.json().items.map((v: any) => v.id)).toEqual([viewer.id]);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(kept.imageUrl)))).toBe(true);
  });

  it('unpinning an expired Highlight deletes it', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();
    await app.inject({ method: 'POST', url: `/api/stories/${story.id}/pin`, headers: authHeader(author) });
    await expire(story.id);

    const res = await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}/pin`, headers: authHeader(author) });
    expect(res.json()).toEqual({ pinnedAt: null, deleted: true });
    expect(await prisma.story.findUnique({ where: { id: story.id } })).toBeNull();
  });

  it('author delete removes every cross-post sibling', async () => {
    const story = (await createStory(author, { groupIds: [family.id, other.id] })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: authHeader(author) });
    expect(del.statusCode).toBe(200);
    expect(await prisma.story.count({ where: { imageUrl: story.imageUrl } })).toBe(0);
  });
});

describe('notifications', () => {
  it('notifies only opted-in members, once per author per group per day', async () => {
    const group = await createGroup({ name: 'Notify family' });
    const poster = await createUser({ name: 'Prolific Poster' });
    const optedIn = await createUser({ name: 'Wants Stories' });
    const optedOut = await createUser({ name: 'No Thanks' });
    for (const u of [poster, optedIn, optedOut]) await addMember(group.id, u.id);
    await prisma.user.update({ where: { id: optedIn.id }, data: { pushOnStory: true } });

    const first = (await createStory(poster, { groupId: group.id })).json();
    await vi.waitFor(async () => {
      expect(await prisma.notification.count({ where: { userId: optedIn.id, type: 'new_story' } })).toBe(1);
    });
    await createStory(poster, { groupId: group.id });
    await new Promise((r) => setTimeout(r, 200));

    expect(await prisma.notification.count({ where: { userId: optedIn.id, type: 'new_story' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: optedOut.id, type: 'new_story' } })).toBe(0);
    const row = await prisma.notification.findFirst({ where: { userId: optedIn.id, type: 'new_story' } });
    expect(row?.relatedStoryId).toBe(first.id);
  });

  it('notifies the author about a reply and a reaction', async () => {
    const story = (await createStory(author, { groupId: family.id })).json();
    await app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/reply`,
      headers: authHeader(insider),
      payload: { content: 'Private note' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/reaction`,
      headers: authHeader(insider),
      payload: { type: 'LOVE' },
    });
    await vi.waitFor(async () => {
      const types = (
        await prisma.notification.findMany({ where: { userId: author.id, relatedStoryId: story.id }, select: { type: true } })
      ).map((n) => n.type);
      expect(types.sort()).toEqual(['story_reaction', 'story_reply']);
    });
  });
});

describe('admin', () => {
  it('lists and deletes stories, excluding circles the admin is not in', async () => {
    const visible = (await createStory(author, { groupId: family.id })).json();
    const circleStory = (await createStory(author, { groupId: family.id, circleId: circle.id })).json();

    const list = await app.inject({ method: 'GET', url: '/api/admin/content/stories', headers: authHeader(admin) });
    const ids = list.json().items.map((s: any) => s.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(circleStory.id);
    expect(JSON.stringify(list.json())).not.toContain('Private note');

    const hidden = await app.inject({
      method: 'DELETE',
      url: `/api/admin/content/stories/${circleStory.id}`,
      headers: authHeader(admin),
    });
    expect(hidden.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/content/stories/${visible.id}`,
      headers: authHeader(admin),
    });
    expect(del.statusCode).toBe(200);
    expect(await prisma.story.findUnique({ where: { id: visible.id } })).toBeNull();

    const nonAdmin = await app.inject({ method: 'GET', url: '/api/admin/content/stories', headers: authHeader(viewer) });
    expect(nonAdmin.statusCode).toBe(403);
  });

  it('exports Highlights but not live stories or replies', async () => {
    const live = (await createStory(author, { groupId: family.id })).json();
    const pinned = (await createStory(author, { groupId: family.id })).json();
    await app.inject({ method: 'POST', url: `/api/stories/${pinned.id}/pin`, headers: authHeader(author) });
    await app.inject({
      method: 'POST',
      url: `/api/stories/${pinned.id}/reply`,
      headers: authHeader(viewer),
      payload: { content: 'An export-excluded reply' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) });
    expect(res.statusCode).toBe(200);
    const zip = res.rawPayload.toString('latin1');
    expect(zip).toContain('data/highlights.json');
    expect(zip).toContain(pinned.id);
    expect(zip).not.toContain(live.id);
    expect(zip).not.toContain('An export-excluded reply');
    expect(zip).toContain(path.basename(pinned.imageUrl));
    expect(zip).not.toContain(path.basename(live.imageUrl));
  });
});
