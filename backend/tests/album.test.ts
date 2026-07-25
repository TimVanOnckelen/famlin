import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroup, createGroupWithMember, addMember, authHeader } from './helpers.js';

// ALBUM posts (services/postTypes/album.ts): a collaborative photo album whose
// author creates it and ANY group member contributes photos via the
// `addPhotos` interaction, with an author-only `close`. Contributions are
// stored as Comment rows with a {kind: 'album_photo', contributionId,
// photoUrls} metadata discriminator, mirroring how a TRIP check-in reuses the
// comment infrastructure. See CLAUDE.md and album.ts for the full contract.
const assetPath = () => `/uploads/${randomUUID()}.jpg`;

describe('ALBUM posts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAlbum(
    author: { id: string; email: string; name: string; isAdmin: boolean },
    groupId: string,
    overrides: Partial<{ title: string; coverPhotoUrl: string }> = {}
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        groupId,
        type: 'ALBUM',
        typeData: { title: overrides.title ?? 'Summer 2026', ...('coverPhotoUrl' in overrides ? { coverPhotoUrl: overrides.coverPhotoUrl } : {}) },
        uploadedAssetUrls: [],
      },
    });
  }

  function addPhotos(token: { authorization: string }, postId: string, value: unknown) {
    return app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/interactions`,
      headers: token,
      payload: { key: 'addPhotos', value },
    });
  }

  describe('creating an album', () => {
    it('creates an album with a title and starts empty', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await createAlbum(author, group.id, { title: 'Beach week' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('ALBUM');
      expect(body.typeData).toMatchObject({ title: 'Beach week', closedAt: null, closedByUserId: null });

      // The enriched `album` view is attached on GET (not on the create response).
      const detail = await app.inject({ method: 'GET', url: `/api/posts/${body.id}`, headers: authHeader(author) });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().album).toMatchObject({ title: 'Beach week', closed: false, photoCount: 0, contributorCount: 0 });
      expect(detail.json().album.collagePhotoUrls).toEqual([]);
    });

    it('rejects an album with no title', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, type: 'ALBUM', typeData: {}, uploadedAssetUrls: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a cover photo that is not an uploads path', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, type: 'ALBUM', typeData: { title: 'X', coverPhotoUrl: 'https://evil.example/x.jpg' }, uploadedAssetUrls: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('contributing photos (addPhotos)', () => {
    it('lets a non-author member add photos and reflects them in enrichment', async () => {
      const author = await createUser();
      const member = await createUser({ name: 'Contributor' });
      const group = await createGroupWithMember(author);
      await addMember(group.id, member.id);
      const albumId = (await createAlbum(author, group.id)).json().id;

      const res = await addPhotos(authHeader(member), albumId, { photoUrls: [assetPath(), assetPath()], caption: 'By the lake' });
      expect(res.statusCode).toBe(200);
      const album = res.json().album;
      expect(album.photoCount).toBe(2);
      expect(album.contributorCount).toBe(1);
      expect(album.contributors[0].id).toBe(member.id);
      expect(album.collagePhotoUrls).toHaveLength(2);
      expect(album.latestContribution).toMatchObject({ contributorName: 'Contributor' });
    });

    it('stores the contribution as a comment with album_photo metadata (caption on content)', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const albumId = (await createAlbum(author, group.id)).json().id;
      await addPhotos(authHeader(author), albumId, { photoUrls: [assetPath()], caption: 'Sunset' });

      const res = await app.inject({ method: 'GET', url: `/api/posts/${albumId}/comments`, headers: authHeader(author) });
      const contribution = res.json().find((c: { metadata?: { kind?: string } }) => c.metadata?.kind === 'album_photo');
      expect(contribution).toBeTruthy();
      expect(contribution.metadata.photoUrls).toHaveLength(1);
      expect(contribution.metadata.contributionId).toBeTruthy();
      expect(contribution.content).toBe('Sunset');
    });

    it('aggregates photoCount/contributorCount across several contributors', async () => {
      const author = await createUser();
      const memberA = await createUser();
      const memberB = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, memberA.id);
      await addMember(group.id, memberB.id);
      const albumId = (await createAlbum(author, group.id)).json().id;

      await addPhotos(authHeader(memberA), albumId, { photoUrls: [assetPath(), assetPath()] });
      await addPhotos(authHeader(memberB), albumId, { photoUrls: [assetPath()] });
      const res = await addPhotos(authHeader(author), albumId, { photoUrls: [assetPath()] });

      const album = res.json().album;
      expect(album.photoCount).toBe(4);
      expect(album.contributorCount).toBe(3);
      // Newest contributor first.
      expect(album.contributors[0].id).toBe(author.id);
    });

    it('rejects a contribution with no photos', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const albumId = (await createAlbum(author, group.id)).json().id;
      const res = await addPhotos(authHeader(author), albumId, { photoUrls: [] });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an arbitrary (non-uploads) photo url', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const albumId = (await createAlbum(author, group.id)).json().id;
      const res = await addPhotos(authHeader(author), albumId, { photoUrls: ['https://evil.example/pixel.gif'] });
      expect(res.statusCode).toBe(400);
    });

    it('blocks a non-member from contributing', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);
      const albumId = (await createAlbum(author, group.id)).json().id;
      const res = await addPhotos(authHeader(outsider), albumId, { photoUrls: [assetPath()] });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('closing an album', () => {
    function close(token: { authorization: string }, postId: string) {
      return app.inject({ method: 'POST', url: `/api/posts/${postId}/interactions`, headers: token, payload: { key: 'close' } });
    }

    it('blocks a non-author from closing', async () => {
      const author = await createUser();
      const member = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, member.id);
      const albumId = (await createAlbum(author, group.id)).json().id;

      const res = await close(authHeader(member), albumId);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only the album's author can do this");
    });

    it('lets the author close it, then rejects further contributions and re-closing', async () => {
      const author = await createUser();
      const member = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, member.id);
      const albumId = (await createAlbum(author, group.id)).json().id;

      const closed = await close(authHeader(author), albumId);
      expect(closed.statusCode).toBe(200);
      expect(closed.json().album.closed).toBe(true);

      const contribute = await addPhotos(authHeader(member), albumId, { photoUrls: [assetPath()] });
      expect(contribute.statusCode).toBe(400);
      expect(contribute.json().error).toBe('This album is closed');

      const reclose = await close(authHeader(author), albumId);
      expect(reclose.statusCode).toBe(400);
    });
  });

  describe('cross-posted albums', () => {
    it('fans a contribution out to every sibling group the contributor belongs to', async () => {
      const author = await createUser();
      const member = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await addMember(groupA.id, member.id);
      await addMember(groupB.id, member.id);

      const create = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: groupA.id, groupIds: [groupA.id, groupB.id], type: 'ALBUM', typeData: { title: 'Shared' }, uploadedAssetUrls: [] },
      });
      expect(create.statusCode).toBe(200);
      const postId = create.json().id;

      const contribute = await addPhotos(authHeader(member), postId, { photoUrls: [assetPath()] });
      expect(contribute.statusCode).toBe(200);

      // One Comment copy per sibling post (both groups the contributor is in).
      const copies = await prisma.comment.count({
        where: { authorId: member.id, metadata: { path: ['kind'], equals: 'album_photo' }, post: { crossPostId: { not: null } } },
      });
      expect(copies).toBe(2);
    });

    it('does not create a copy in a sibling group the contributor is not a member of', async () => {
      const author = await createUser();
      const member = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      // member is in A only.
      await addMember(groupA.id, member.id);

      const create = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: groupA.id, groupIds: [groupA.id, groupB.id], type: 'ALBUM', typeData: { title: 'Shared 2' }, uploadedAssetUrls: [] },
      });
      const postId = create.json().id;

      const contribute = await addPhotos(authHeader(member), postId, { photoUrls: [assetPath()] });
      expect(contribute.statusCode).toBe(200);

      // Only the group-A sibling (the invoked post) gets a copy — member isn't
      // in group B, so no copy is created there.
      const copies = await prisma.comment.count({
        where: { authorId: member.id, metadata: { path: ['kind'], equals: 'album_photo' } },
      });
      expect(copies).toBe(1);
    });
  });

  describe('allowed post types gating', () => {
    it('is rejected in a group that disallows ALBUM', async () => {
      const author = await createUser();
      const group = await createGroup();
      await addMember(group.id, author.id);
      await prisma.group.update({ where: { id: group.id }, data: { allowedPostTypes: ['UPDATE'] } });

      const res = await createAlbum(author, group.id);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('unknown interaction key', () => {
    it('rejects an unknown key on an album', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const albumId = (await createAlbum(author, group.id)).json().id;
      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${albumId}/interactions`,
        headers: authHeader(author),
        payload: { key: 'bogus', value: {} },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
