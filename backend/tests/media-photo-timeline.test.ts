import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { __registerMediaProviderForTests, __unregisterMediaProviderForTests } from '../src/services/media/registry.js';
import { __clearPhotoTimelineCacheForTests } from '../src/services/media/photoTimeline.js';
import type { MediaProvider, MediaAssetSummary } from '../src/services/media/types.js';
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js';

// A minimal fake provider, mirroring media-people.test.ts/person-tags.test.ts's
// makeFakeProvider — lets the merge/pagination/fail-soft logic be exercised
// without depending on a real Immich server or the local filesystem.
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
      // unused by these tests
    },
    ...overrides,
  };
}

function asset(id: string, takenAt: string, overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return { id, type: 'IMAGE', width: 10, height: 10, originalExt: 'jpg', takenAt, addedAt: takenAt, ...overrides };
}

describe('GET /api/media/groups/:groupId/photos', () => {
  let app: FastifyInstance;
  const FAKE_PROVIDER_ID = 'fake-photo-timeline-provider';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    __unregisterMediaProviderForTests(FAKE_PROVIDER_ID);
    __clearPhotoTimelineCacheForTests();
  });

  it('rejects a non-member of the group', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(member);

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s for an unknown group id (mirrors the other group-scoped media endpoints)', async () => {
    const member = await createUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/media/groups/does-not-exist/photos',
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(403);
  });

  it('merges album assets and post uploads, ordered newest-capture-first', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async listAlbumAssets() {
          return [
            asset('asset-old', '2024-01-01T00:00:00.000Z'),
            asset('asset-new', '2024-06-01T00:00:00.000Z'),
          ];
        },
      })
    );
    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'fake-album', albumName: 'Fake Album' },
    });

    // A post-upload photo with a createdAt in between the two album assets.
    const post = await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: ['/uploads/11111111-1111-1111-1111-111111111111.jpg'],
    });
    await prisma.post.update({ where: { id: post.id }, data: { createdAt: new Date('2024-03-01T00:00:00.000Z') } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; source: string; takenAt: string }>; nextCursor: string | null };
    expect(body.items.map((i) => i.id)).toEqual([
      `album:${link.id}:asset-new`,
      `post:${post.id}:0`,
      `album:${link.id}:asset-old`,
    ]);
    expect(body.nextCursor).toBeNull();
    const postItem = body.items.find((i) => i.source === 'post')!;
    expect(postItem).toMatchObject({ postId: post.id, thumbnailUrl: '/uploads/11111111-1111-1111-1111-111111111111.jpg' });
  });

  it('does not duplicate media-proxy URLs stored in a post', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async listAlbumAssets() {
          return [asset('asset-a', '2024-05-01T00:00:00.000Z')];
        },
      })
    );
    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'proxy-album', albumName: 'Proxy Album' },
    });

    // Simulates a post whose photo was picked from the linked-album picker —
    // the URL shape routes/media.ts's asset proxy generates.
    await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: [`/api/media/assets/${link.id}/asset-a/thumbnail.jpg`],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(`album:${link.id}:asset-a`);
  });

  it('paginates with a keyset cursor, returning disjoint pages that end with a null cursor', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    const assets = Array.from({ length: 5 }, (_, i) =>
      asset(`asset-${i}`, new Date(2024, 0, i + 1).toISOString())
    );
    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async listAlbumAssets() {
          return assets;
        },
      })
    );
    await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'paged-album', albumName: 'Paged' },
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/media/groups/${group.id}/photos?take=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...body.items.map((i) => i.id));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // disjoint pages — no id repeated across pages
  });

  it('fails soft: a throwing provider still yields the post uploads', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async listAlbumAssets() {
          throw new Error('boom: provider unreachable');
        },
      })
    );
    await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'broken-album', albumName: 'Broken' },
    });

    const post = await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: ['/uploads/22222222-2222-2222-2222-222222222222.jpg'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(member),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toEqual([`post:${post.id}:0`]);
  });

  describe('?personId=', () => {
    it('404s when personId has no MediaPersonLink mapping anywhere', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/groups/${group.id}/photos?personId=never-mapped`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns only that person\'s album assets, excluding post uploads entirely', async () => {
      const member = await createUser();
      const group = await createGroupWithMember(member);

      __registerMediaProviderForTests(
        makeFakeProvider(FAKE_PROVIDER_ID, {
          async listAlbumAssets() {
            return [asset('asset-a', '2024-05-01T00:00:00.000Z'), asset('asset-b', '2024-05-02T00:00:00.000Z')];
          },
          async getAlbumAssetPeople() {
            return new Map([['asset-b', [{ id: 'person-b', name: 'B Person' }]]]);
          },
        })
      );
      const link = await prisma.mediaAlbumLink.create({
        data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'people-album', albumName: 'People' },
      });
      await prisma.mediaPersonLink.create({
        data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-b', label: 'B Person' },
      });

      await createPost({
        groupId: group.id,
        authorId: member.id,
        uploadedAssetUrls: ['/uploads/33333333-3333-3333-3333-333333333333.jpg'],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/media/groups/${group.id}/photos?personId=person-b`,
        headers: authHeader(member),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string; source: string }> };
      expect(body.items.map((i) => i.id)).toEqual([`album:${link.id}:asset-b`]);
      expect(body.items.every((i) => i.source === 'album')).toBe(true);
    });
  });
});
