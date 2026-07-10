import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { runNewAssetsJob } from '../src/jobs/newAssets.js';
import { __registerMediaProviderForTests, __unregisterMediaProviderForTests } from '../src/services/media/registry.js';
import type { MediaProvider } from '../src/services/media/types.js';
import { buildTestApp, createUser, createGroupWithMember, addMember } from './helpers.js';

// Exercises runNewAssetsJob against a fake in-memory MediaProvider registered
// just for this file — never a real Immich/local source. Mirrors
// tests/media-people.test.ts's fake-provider pattern.
function makeFakeProvider(id: string, overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    id,
    async isConfigured() {
      return true;
    },
    isValidAlbumId() {
      return true;
    },
    async listAlbums() {
      return [];
    },
    async getAlbumInfo() {
      return { assetCount: 0 };
    },
    async listAlbumAssets() {
      return [];
    },
    async isAssetInAlbum() {
      return true;
    },
    async streamAsset() {
      // unused
    },
    ...overrides,
  };
}

describe('runNewAssetsJob', () => {
  const PROVIDER_ID = 'fake-new-assets-provider';
  // AUTO mode's post creation emits 'post.created' onto the same domain-event
  // bus routes/posts.ts uses (see events.ts) — buildTestApp() is what wires
  // the notifications subscriber onto it (see app.ts), so the "AUTO mode"
  // test below can assert the resulting notification actually fires.
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    __unregisterMediaProviderForTests(PROVIDER_ID);
  });

  it('ignores links with newAssetMode OFF', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await prisma.mediaAlbumLink.create({
      data: {
        groupId: group.id,
        provider: PROVIDER_ID,
        externalAlbumId: 'off-album',
        albumName: 'Off',
        newAssetMode: 'OFF',
        newAssetsCheckedAt: new Date(Date.now() - 60_000),
      },
    });

    __registerMediaProviderForTests(
      makeFakeProvider(PROVIDER_ID, {
        async listAlbumAssets() {
          throw new Error('should never be called for an OFF link');
        },
      })
    );

    await runNewAssetsJob(new Date());

    const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
    expect(stored?.newAssetsCheckedAt?.getTime()).toBe(link.newAssetsCheckedAt!.getTime());
  });

  it('first run only initializes the watermark, without notifying', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);
    const link = await prisma.mediaAlbumLink.create({
      data: {
        groupId: group.id,
        provider: PROVIDER_ID,
        externalAlbumId: 'first-run-album',
        albumName: 'First Run',
        newAssetMode: 'MANUAL',
        newAssetsCheckedAt: null,
      },
    });

    __registerMediaProviderForTests(
      makeFakeProvider(PROVIDER_ID, {
        async listAlbumAssets() {
          return [{ id: 'a1', type: 'IMAGE', width: 1, height: 1, originalExt: 'jpg', addedAt: new Date().toISOString() }];
        },
      })
    );

    const now = new Date();
    await runNewAssetsJob(now);

    const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
    expect(stored?.newAssetsCheckedAt?.getTime()).toBe(now.getTime());

    const notifications = await prisma.notification.findMany({ where: { userId: member.id } });
    expect(notifications).toHaveLength(0);
  });

  it('MANUAL mode notifies other group members when new assets appear', async () => {
    const memberA = await createUser();
    const memberB = await createUser();
    const group = await createGroupWithMember(memberA);
    await addMember(group.id, memberB.id);

    const checkedAt = new Date(Date.now() - 60 * 60 * 1000);
    const link = await prisma.mediaAlbumLink.create({
      data: {
        groupId: group.id,
        provider: PROVIDER_ID,
        externalAlbumId: 'manual-album',
        albumName: 'Manual Album',
        newAssetMode: 'MANUAL',
        newAssetsCheckedAt: checkedAt,
      },
    });

    const freshAddedAt = new Date().toISOString();
    __registerMediaProviderForTests(
      makeFakeProvider(PROVIDER_ID, {
        async listAlbumAssets() {
          return [
            { id: 'old', type: 'IMAGE', width: 1, height: 1, originalExt: 'jpg', addedAt: new Date(checkedAt.getTime() - 1000).toISOString() },
            { id: 'new1', type: 'IMAGE', width: 1, height: 1, originalExt: 'jpg', addedAt: freshAddedAt },
            { id: 'new2', type: 'VIDEO', width: 1, height: 1, originalExt: 'mp4', addedAt: freshAddedAt },
          ];
        },
      })
    );

    const now = new Date();
    await runNewAssetsJob(now);

    const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
    expect(stored?.newAssetsCheckedAt?.getTime()).toBe(now.getTime());

    // No post is created in MANUAL mode.
    expect(await prisma.post.count({ where: { groupId: group.id } })).toBe(0);

    const notifications = await prisma.notification.findMany({
      where: { userId: { in: [memberA.id, memberB.id] }, type: 'new_media_assets' },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications[0].message).toContain('Manual Album');
    // Not tied to a specific post.
    expect(notifications[0].relatedPostId).toBeNull();
  });

  it('AUTO mode creates a post authored by an admin member with the new assets attached', async () => {
    const admin = await createUser({ isAdmin: true, name: 'Group Admin' });
    const member = await createUser();
    const group = await createGroupWithMember(admin);
    await addMember(group.id, member.id);

    const checkedAt = new Date(Date.now() - 60 * 60 * 1000);
    const link = await prisma.mediaAlbumLink.create({
      data: {
        groupId: group.id,
        provider: PROVIDER_ID,
        externalAlbumId: 'auto-album',
        albumName: 'Auto Album',
        newAssetMode: 'AUTO',
        newAssetsCheckedAt: checkedAt,
      },
    });

    const freshAddedAt = new Date().toISOString();
    __registerMediaProviderForTests(
      makeFakeProvider(PROVIDER_ID, {
        async listAlbumAssets() {
          return [
            { id: 'auto-new-1', type: 'IMAGE', width: 1, height: 1, originalExt: 'jpg', addedAt: freshAddedAt },
            { id: 'auto-new-2', type: 'VIDEO', width: 1, height: 1, originalExt: 'mp4', addedAt: freshAddedAt },
          ];
        },
      })
    );

    const now = new Date();
    await runNewAssetsJob(now);

    const post = await prisma.post.findFirst({ where: { groupId: group.id } });
    expect(post).not.toBeNull();
    expect(post!.authorId).toBe(admin.id);
    expect(post!.content).toContain('Auto Album');
    expect(post!.uploadedAssetUrls).toEqual([
      `/api/media/assets/${link.id}/auto-new-1/preview.jpg`,
      `/api/media/assets/${link.id}/auto-new-2/original.mp4`,
    ]);

    const stored = await prisma.mediaAlbumLink.findUnique({ where: { id: link.id } });
    expect(stored?.newAssetsCheckedAt?.getTime()).toBe(now.getTime());

    // The domain event fired by the job should have produced a 'new_post'
    // notification for the other member (fire-and-forget, so wait for it).
    await vi.waitFor(async () => {
      const notifications = await prisma.notification.findMany({ where: { userId: member.id, type: 'new_post' } });
      expect(notifications).toHaveLength(1);
    });
  });

  it('one broken link does not stop the others from being processed', async () => {
    const memberA = await createUser();
    const groupA = await createGroupWithMember(memberA);
    const brokenLink = await prisma.mediaAlbumLink.create({
      data: {
        groupId: groupA.id,
        provider: 'unregistered-provider-id',
        externalAlbumId: 'broken',
        albumName: 'Broken',
        newAssetMode: 'MANUAL',
        newAssetsCheckedAt: new Date(Date.now() - 60_000),
      },
    });

    const memberB = await createUser();
    const groupB = await createGroupWithMember(memberB);
    const healthyLink = await prisma.mediaAlbumLink.create({
      data: {
        groupId: groupB.id,
        provider: PROVIDER_ID,
        externalAlbumId: 'healthy',
        albumName: 'Healthy',
        newAssetMode: 'MANUAL',
        newAssetsCheckedAt: new Date(Date.now() - 60_000),
      },
    });

    __registerMediaProviderForTests(
      makeFakeProvider(PROVIDER_ID, {
        async listAlbumAssets() {
          return [{ id: 'h1', type: 'IMAGE', width: 1, height: 1, originalExt: 'jpg', addedAt: new Date().toISOString() }];
        },
      })
    );

    const now = new Date();
    await expect(runNewAssetsJob(now)).resolves.not.toThrow();

    // The broken link's provider doesn't exist, so it's skipped without
    // advancing its watermark.
    const brokenStored = await prisma.mediaAlbumLink.findUnique({ where: { id: brokenLink.id } });
    expect(brokenStored?.newAssetsCheckedAt?.getTime()).not.toBe(now.getTime());

    // The healthy link in the same run is still processed normally.
    const healthyStored = await prisma.mediaAlbumLink.findUnique({ where: { id: healthyLink.id } });
    expect(healthyStored?.newAssetsCheckedAt?.getTime()).toBe(now.getTime());
    expect(await prisma.notification.count({ where: { userId: memberB.id, type: 'new_media_assets' } })).toBe(1);
  });
});
