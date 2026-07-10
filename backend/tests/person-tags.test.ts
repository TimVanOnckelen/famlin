import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { __registerMediaProviderForTests, __unregisterMediaProviderForTests } from '../src/services/media/registry.js';
import { __clearPersonTagCacheForTests } from '../src/services/media/personTags.js';
import type { MediaProvider } from '../src/services/media/types.js';
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js';

// A minimal fake provider that only needs to support getPersonAssetIds() —
// the rest of the MediaProvider contract is unused by these tests (mirrors
// media-people.test.ts's makeFakeProvider).
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

function mediaAssetPath(linkId: string, assetId: string) {
  return `/api/media/assets/${linkId}/${assetId}/thumbnail.jpg`;
}

describe('person tags on posts', () => {
  let app: FastifyInstance;
  const FAKE_PROVIDER_ID = 'fake-person-tags-provider';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    __unregisterMediaProviderForTests(FAKE_PROVIDER_ID);
    __clearPersonTagCacheForTests();
    // Each test creates whatever MediaPersonLink rows it needs up front —
    // clear them between tests (tables are only truncated once per *file*,
    // see tests/setup/test-setup.ts) so the "no mappings at all" fast-exit
    // test isn't polluted by rows earlier tests in this file created.
    await prisma.mediaPersonLink.deleteMany();
  });

  it('tags a feed post whose asset matches a mapped person', async () => {
    const member = await createUser();
    const mappedUser = await createUser({ name: 'Aunt May' });
    const group = await createGroupWithMember(member);

    let calls = 0;
    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async getPersonAssetIds() {
          calls += 1;
          return new Set(['asset-1']);
        },
      })
    );

    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-1', albumName: 'Album' },
    });
    const personLink = await prisma.mediaPersonLink.create({
      data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-1', label: 'Aunt May', userId: mappedUser.id },
    });

    const post = await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: [mediaAssetPath(link.id, 'asset-1')],
    });

    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; people: unknown[] }>;
    const shaped = items.find((p) => p.id === post.id)!;
    expect(shaped.people).toEqual([
      {
        id: personLink.externalPersonId,
        provider: FAKE_PROVIDER_ID,
        label: 'Aunt May',
        userId: mappedUser.id,
        userName: 'Aunt May',
        userAvatarUrl: null,
      },
    ]);
    expect(calls).toBe(1);
  });

  it('returns people: [] for a post with no media assets', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    // A person mapping exists (so the fast-exit path isn't what's being
    // tested), but this post has no uploadedAssetUrls at all.
    await prisma.mediaPersonLink.create({
      data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-none', label: 'Nobody Relevant' },
    });

    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [] });

    const res = await app.inject({ method: 'GET', url: `/api/posts/${post.id}`, headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    expect(res.json().people).toEqual([]);
  });

  it('still returns 200 with people: [] when the provider throws', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async getPersonAssetIds() {
          throw new Error('Immich is down');
        },
      })
    );

    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-broken', albumName: 'Album' },
    });
    await prisma.mediaPersonLink.create({
      data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-broken', label: 'Broken Person' },
    });

    const post = await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: [mediaAssetPath(link.id, 'asset-x')],
    });

    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; people: unknown[] }>;
    expect(items.find((p) => p.id === post.id)!.people).toEqual([]);
  });

  it('caches a person’s resolved asset ids so a second request does not re-hit the provider', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    let calls = 0;
    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async getPersonAssetIds() {
          calls += 1;
          return new Set(['asset-cached']);
        },
      })
    );

    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-cache', albumName: 'Album' },
    });
    await prisma.mediaPersonLink.create({
      data: { provider: FAKE_PROVIDER_ID, externalPersonId: 'person-cache', label: 'Cached Person' },
    });

    await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: [mediaAssetPath(link.id, 'asset-cached')],
    });

    const first = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) });
    expect(second.statusCode).toBe(200);

    expect(calls).toBe(1);
    const items = second.json().items as Array<{ people: Array<{ label: string }> }>;
    expect(items[0].people.map((p) => p.label)).toEqual(['Cached Person']);
  });

  it('never calls the provider when no MediaPersonLink rows exist', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    let calls = 0;
    __registerMediaProviderForTests(
      makeFakeProvider(FAKE_PROVIDER_ID, {
        async getPersonAssetIds() {
          calls += 1;
          return new Set(['asset-unused']);
        },
      })
    );

    const link = await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: FAKE_PROVIDER_ID, externalAlbumId: 'album-unmapped', albumName: 'Album' },
    });

    await createPost({
      groupId: group.id,
      authorId: member.id,
      uploadedAssetUrls: [mediaAssetPath(link.id, 'asset-unused')],
    });

    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) });
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(0);
  });
});
