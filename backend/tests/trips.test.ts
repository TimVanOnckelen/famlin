import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js';

// TRIP posts (services/postTypes/trip.ts): a living travel journal whose
// check-ins are stored as Comment rows with a `metadata` discriminator
// ({kind: 'trip_checkin', place, photoUrls}) so per-check-in
// reactions/replies ride the existing comment infrastructure. See CLAUDE.md
// and trip.ts's own comments for the full contract.
const assetPath = () => `/uploads/${randomUUID()}.jpg`;

function isoDate(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

describe('TRIP posts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTrip(
    author: { id: string; email: string; name: string; isAdmin: boolean },
    groupId: string,
    overrides: Partial<{
      title: string;
      destination: string;
      startDate: string;
      endDate: string;
      coverPhotoUrl: string;
      travelerUserIds: string[];
    }> = {}
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        groupId,
        content: 'Off we go!',
        type: 'TRIP',
        typeData: {
          title: overrides.title ?? 'Roadtrip',
          destination: overrides.destination,
          startDate: overrides.startDate ?? isoDate(0),
          endDate: overrides.endDate,
          coverPhotoUrl: overrides.coverPhotoUrl,
          travelerUserIds: overrides.travelerUserIds,
        },
      },
    });
    return res;
  }

  describe('creating a trip', () => {
    it('persists typeData with closedAt/closedByUserId null and no `trip` on the create response', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await createTrip(author, group.id, { title: 'Alps', destination: 'Switzerland', startDate: isoDate(0), endDate: isoDate(5) });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('TRIP');
      expect(body.typeData).toEqual({
        title: 'Alps',
        destination: 'Switzerland',
        startDate: isoDate(0),
        endDate: isoDate(5),
        coverPhotoUrl: null,
        travelerUserIds: [],
        closedAt: null,
        closedByUserId: null,
      });
      expect(body.trip).toBeUndefined();

      const get = await app.inject({ method: 'GET', url: `/api/posts/${body.id}`, headers: authHeader(author) });
      expect(get.statusCode).toBe(200);
      expect(get.json().trip.title).toBe('Alps');
      expect(get.json().trip.closed).toBe(false);
    });

    it('accepts a valid /uploads/ coverPhotoUrl', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const cover = assetPath();

      const res = await createTrip(author, group.id, { coverPhotoUrl: cover });
      expect(res.statusCode).toBe(200);
      expect(res.json().typeData.coverPhotoUrl).toBe(cover);
    });

    it('rejects endDate before startDate', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await createTrip(author, group.id, { startDate: isoDate(0), endDate: isoDate(-3) });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an external (non-/uploads/) coverPhotoUrl', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await createTrip(author, group.id, { coverPhotoUrl: 'https://evil.example.com/tracker.jpg' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing title', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, type: 'TRIP', typeData: { startDate: isoDate(0) } },
      });
      expect(res.statusCode).toBe(400);
    });

  });

  describe('check-in interaction', () => {
    it('lets the author check in, creating a metadata-tagged Comment and enriching trip.stopCount/latestCheckin', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();
      const photo = assetPath();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Geneva', text: 'Arrived!', photoUrls: [photo] } },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.trip.stopCount).toBe(1);
      expect(body.trip.photoCount).toBe(1);
      expect(body.trip.latestCheckin.place).toBe('Geneva');
      expect(body.trip.collagePhotoUrls).toEqual([photo]);

      const comment = await prisma.comment.findFirstOrThrow({ where: { postId: trip.id } });
      expect(comment.authorId).toBe(author.id);
      expect(comment.content).toBe('Arrived!');
      expect(comment.metadata).toEqual({
        kind: 'trip_checkin',
        checkinId: expect.any(String),
        place: 'Geneva',
        photoUrls: [photo],
      });
    });

    it('allows a check-in with no text (place only)', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Lyon' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trip.latestCheckin.place).toBe('Lyon');
    });

    it('rejects a group member who is neither author nor traveler checking in', async () => {
      const author = await createUser();
      const other = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, other.id);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(other),
        payload: { key: 'checkin', value: { place: 'Nowhere' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only the trip's travelers can check in");
    });

    it('rejects checking in on a closed trip', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const close = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });
      expect(close.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Too late' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('This trip is closed');
    });

    it('rejects a check-in missing place', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { text: 'no place given' } },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('co-travelers', () => {
    it('lets a designated co-traveler check in', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, traveler.id);
      const trip = await (await createTrip(author, group.id, { travelerUserIds: [traveler.id] })).json();
      expect(trip.typeData.travelerUserIds).toEqual([traveler.id]);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(traveler),
        payload: { key: 'checkin', value: { place: 'Co-traveler stop' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trip.latestCheckin.place).toBe('Co-traveler stop');

      const comment = await prisma.comment.findFirstOrThrow({ where: { postId: trip.id } });
      expect(comment.authorId).toBe(traveler.id);
    });

    it('rejects creating a trip with a travelerUserId who is not a group member', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);

      const res = await createTrip(author, group.id, { title: 'No outsiders', travelerUserIds: [outsider.id] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Every traveler must be a member of this group');
      expect(await prisma.post.count({ where: { groupId: group.id } })).toBe(0);
    });

    it('strips the author id from travelerUserIds and never duplicates the author in enrichment', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, traveler.id);

      const trip = await (
        await createTrip(author, group.id, { travelerUserIds: [author.id, traveler.id, traveler.id] })
      ).json();
      // Author stripped, duplicate deduped.
      expect(trip.typeData.travelerUserIds).toEqual([traveler.id]);

      const get = await app.inject({ method: 'GET', url: `/api/posts/${trip.id}`, headers: authHeader(author) });
      expect(get.statusCode).toBe(200);
      expect(get.json().trip.travelers).toEqual([{ id: traveler.id, name: traveler.name, avatarUrl: null }]);
    });

    it('setTravelers by the author replaces the list and the new traveler can check in', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, traveler.id);
      const trip = await (await createTrip(author, group.id)).json();

      // Not yet a traveler.
      const before = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(traveler),
        payload: { key: 'checkin', value: { place: 'Too early' } },
      });
      expect(before.statusCode).toBe(400);
      expect(before.json().error).toBe("Only the trip's travelers can check in");

      const set = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [traveler.id] } },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json().trip.travelers).toEqual([{ id: traveler.id, name: traveler.name, avatarUrl: null }]);

      const after = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(traveler),
        payload: { key: 'checkin', value: { place: 'Now allowed' } },
      });
      expect(after.statusCode).toBe(200);
      expect(after.json().trip.latestCheckin.place).toBe('Now allowed');

      // Replacing with an empty list revokes again.
      const clear = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [] } },
      });
      expect(clear.statusCode).toBe(200);
      expect(clear.json().trip.travelers).toEqual([]);

      const revoked = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(traveler),
        payload: { key: 'checkin', value: { place: 'Revoked' } },
      });
      expect(revoked.statusCode).toBe(400);
    });

    it('rejects setTravelers by a non-author', async () => {
      const author = await createUser();
      const other = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, other.id);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(other),
        payload: { key: 'setTravelers', value: { userIds: [other.id] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only the trip's author can do this");
    });

    it('rejects setTravelers with a non-member id', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [outsider.id] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Every traveler must be a member of this group');

      const row = await prisma.post.findUniqueOrThrow({ where: { id: trip.id } });
      expect((row.typeData as any).travelerUserIds).toEqual([]);
    });

    it('rejects setTravelers on a closed trip', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, traveler.id);
      const trip = await (await createTrip(author, group.id)).json();

      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [traveler.id] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('This trip is closed');
    });
  });

  describe('close interaction', () => {
    it('lets the author close the trip', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trip.closed).toBe(true);

      const row = await prisma.post.findUniqueOrThrow({ where: { id: trip.id } });
      expect((row.typeData as any).closedAt).not.toBeNull();
      expect((row.typeData as any).closedByUserId).toBe(author.id);
    });

    it('rejects closing an already-closed trip', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('This trip is closed');
    });

    it('rejects a non-author closing the trip', async () => {
      const author = await createUser();
      const other = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, other.id);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(other),
        payload: { key: 'close' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only the trip's author can do this");
    });
  });

  describe('auto-close', () => {
    it('reports closed:true once endDate has fully elapsed, with no close interaction', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id, { startDate: isoDate(-3), endDate: isoDate(-1) })).json();

      const get = await app.inject({ method: 'GET', url: `/api/posts/${trip.id}`, headers: authHeader(author) });
      expect(get.statusCode).toBe(200);
      expect(get.json().trip.closed).toBe(true);
      expect(get.json().trip.closedAt).toBeNull();
      expect(get.json().trip.dayNumber).toBeNull();
      expect(get.json().trip.durationDays).toBe(3);

      const row = await prisma.post.findUniqueOrThrow({ where: { id: trip.id } });
      expect((row.typeData as any).closedAt).toBeNull();
    });
  });

  describe('enrichment on GET /api/posts', () => {
    it('computes stopCount/photoCount/collagePhotoUrls, ignoring plain (non-check-in) comments', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const trip = await (await createTrip(author, group.id)).json();

      const photoA = assetPath();
      const photoB = assetPath();
      const photoC = assetPath();

      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Stop 1', photoUrls: [photoA] } },
      });
      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Stop 2', photoUrls: [photoB, photoC] } },
      });
      // A plain comment (no metadata) — must NOT count as a stop.
      const plainComment = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/comments`,
        headers: authHeader(author),
        payload: { content: 'nice trip!' },
      });
      expect(plainComment.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) });
      expect(list.statusCode).toBe(200);
      const tripInFeed = list.json().items.find((p: any) => p.id === trip.id);
      expect(tripInFeed.trip.stopCount).toBe(2);
      expect(tripInFeed.trip.photoCount).toBe(3);
      // Newest 3 check-in photos, newest first: Stop 2's photos (B, C) came
      // after Stop 1's (A) — collage is [C, B, A] within the 3-photo cap.
      expect(tripInFeed.trip.collagePhotoUrls).toEqual([photoC, photoB, photoA]);
    });
  });

  describe('regular comments cannot set metadata', () => {
    it('drops an attempted client-sent metadata field', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const post = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'a plain post' },
      });
      const postId = post.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${postId}/comments`,
        headers: authHeader(author),
        payload: { content: 'trying to sneak in metadata', metadata: { kind: 'trip_checkin', place: 'Nowhere', photoUrls: [] } },
      });
      expect(res.statusCode).toBe(200);

      const row = await prisma.comment.findFirstOrThrow({ where: { postId } });
      expect(row.metadata).toBeNull();
    });
  });

  describe('check-in notifications', () => {
    it('notifies other group members with trip_checkin, not the author, and never new_comment', async () => {
      const author = await createUser();
      const other = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, other.id);
      const trip = await (await createTrip(author, group.id)).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Somewhere nice' } },
      });
      expect(res.statusCode).toBe(200);

      // Trip creation itself already notified `other` with `new_post` — scope
      // to `trip_checkin` specifically so this assertion is about the
      // check-in notification, not a count of every notification on the post.
      const otherNotifications = await prisma.notification.findMany({
        where: { relatedPostId: trip.id, userId: other.id, type: 'trip_checkin' },
      });
      expect(otherNotifications).toHaveLength(1);
      expect(otherNotifications[0].message).toContain('Somewhere nice');

      const authorNotifications = await prisma.notification.findMany({
        where: { relatedPostId: trip.id, userId: author.id, type: 'trip_checkin' },
      });
      expect(authorNotifications).toHaveLength(0);

      const newCommentNotifications = await prisma.notification.findMany({ where: { relatedPostId: trip.id, type: 'new_comment' } });
      expect(newCommentNotifications).toHaveLength(0);
    });

    it('uses the "checked in N times today" copy from the second check-in of the same day onward', async () => {
      const author = await createUser();
      const other = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, other.id);
      const trip = await (await createTrip(author, group.id)).json();

      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'First stop' } },
      });
      await app.inject({
        method: 'POST',
        url: `/api/posts/${trip.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Second stop' } },
      });

      const notifications = await prisma.notification.findMany({
        where: { relatedPostId: trip.id, userId: other.id, type: 'trip_checkin' },
        orderBy: { createdAt: 'asc' },
      });
      expect(notifications).toHaveLength(2);
      expect(notifications[0].message).toBe(`${author.name} checked in at First stop`);
      expect(notifications[1].message).toBe(`${author.name} checked in 2 times today · last stop: Second stop`);
    });
  });

  describe('cross-posted trips', () => {
    async function createCrossTrip(
      author: { id: string; email: string; name: string; isAdmin: boolean },
      groupIds: string[],
      travelerUserIds?: string[]
    ) {
      return app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupIds,
          content: 'Cross trip!',
          type: 'TRIP',
          typeData: { title: 'Cross trip', startDate: isoDate(0), travelerUserIds },
        },
      });
    }

    async function getSiblings(groupAId: string, groupBId: string) {
      const a = await prisma.post.findFirstOrThrow({ where: { groupId: groupAId, type: 'TRIP' } });
      const b = await prisma.post.findFirstOrThrow({ where: { groupId: groupBId, type: 'TRIP' } });
      return { a, b };
    }

    it('creates one sibling per target group sharing crossPostId and identical typeData', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);

      const res = await createCrossTrip(author, [groupA.id, groupB.id]);
      expect(res.statusCode).toBe(200);
      expect(res.json().sharedWithGroups).toHaveLength(2);

      const { a, b } = await getSiblings(groupA.id, groupB.id);
      expect(a.crossPostId).not.toBeNull();
      expect(a.crossPostId).toBe(b.crossPostId);
      expect(a.typeData).toEqual(b.typeData);
    });

    it('rejects a traveler who is a member of only one target group', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await addMember(groupA.id, traveler.id); // NOT in groupB

      const res = await createCrossTrip(author, [groupA.id, groupB.id], [traveler.id]);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Every traveler must be a member of this group');
      // Scoped to this test's own groups — truncation is per-file, so other
      // tests' cross-trips (same content) exist alongside.
      expect(await prisma.post.count({ where: { groupId: { in: [groupA.id, groupB.id] } } })).toBe(0);

      // A traveler in BOTH groups is fine.
      await addMember(groupB.id, traveler.id);
      const ok = await createCrossTrip(author, [groupA.id, groupB.id], [traveler.id]);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().typeData.travelerUserIds).toEqual([traveler.id]);
    });

    it('fans a check-in out to every sibling with a shared checkinId, enriching both consistently', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await createCrossTrip(author, [groupA.id, groupB.id]);
      const { a, b } = await getSiblings(groupA.id, groupB.id);
      const photo = assetPath();

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Both groups', photoUrls: [photo] } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trip.stopCount).toBe(1);

      const copyA = await prisma.comment.findFirstOrThrow({ where: { postId: a.id } });
      const copyB = await prisma.comment.findFirstOrThrow({ where: { postId: b.id } });
      expect((copyA.metadata as any).checkinId).toBeDefined();
      expect((copyA.metadata as any).checkinId).toBe((copyB.metadata as any).checkinId);
      expect((copyB.metadata as any).place).toBe('Both groups');

      const getB = await app.inject({ method: 'GET', url: `/api/posts/${b.id}`, headers: authHeader(author) });
      expect(getB.statusCode).toBe(200);
      expect(getB.json().trip.stopCount).toBe(1);
      expect(getB.json().trip.photoCount).toBe(1);
      expect(getB.json().trip.collagePhotoUrls).toEqual([photo]);
      expect(getB.json().trip.latestCheckin.commentId).toBe(copyB.id);
    });

    it('notifies a member of both sibling groups exactly once per check-in', async () => {
      const author = await createUser();
      const both = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await addMember(groupA.id, both.id);
      await addMember(groupB.id, both.id);
      await createCrossTrip(author, [groupA.id, groupB.id]);
      const { a } = await getSiblings(groupA.id, groupB.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Dedupe town' } },
      });
      expect(res.statusCode).toBe(200);

      const notifications = await prisma.notification.findMany({ where: { userId: both.id, type: 'trip_checkin' } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain('Dedupe town');
    });

    it('fans close out to every sibling', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await createCrossTrip(author, [groupA.id, groupB.id]);
      const { a, b } = await getSiblings(groupA.id, groupB.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'close' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trip.closed).toBe(true);

      const rowB = await prisma.post.findUniqueOrThrow({ where: { id: b.id } });
      expect((rowB.typeData as any).closedAt).not.toBeNull();
      expect((rowB.typeData as any).closedByUserId).toBe(author.id);

      // And a check-in via the OTHER sibling is now rejected too.
      const checkin = await app.inject({
        method: 'POST',
        url: `/api/posts/${b.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Too late' } },
      });
      expect(checkin.statusCode).toBe(400);
      expect(checkin.json().error).toBe('This trip is closed');
    });

    it('fans setTravelers out to every sibling and requires membership in all sibling groups', async () => {
      const author = await createUser();
      const traveler = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await addMember(groupA.id, traveler.id); // only in A at first
      await createCrossTrip(author, [groupA.id, groupB.id]);
      const { a, b } = await getSiblings(groupA.id, groupB.id);

      const rejected = await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [traveler.id] } },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error).toBe('Every traveler must be a member of this group');

      await addMember(groupB.id, traveler.id);
      const ok = await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'setTravelers', value: { userIds: [traveler.id] } },
      });
      expect(ok.statusCode).toBe(200);

      const rowB = await prisma.post.findUniqueOrThrow({ where: { id: b.id } });
      expect((rowB.typeData as any).travelerUserIds).toEqual([traveler.id]);

      // The new traveler can check in via EITHER sibling.
      const checkin = await app.inject({
        method: 'POST',
        url: `/api/posts/${b.id}/interactions`,
        headers: authHeader(traveler),
        payload: { key: 'checkin', value: { place: 'Via sibling B' } },
      });
      expect(checkin.statusCode).toBe(200);
    });

    it('author deleting a check-in removes every sibling copy; admin moderation removes one', async () => {
      const author = await createUser();
      const admin = await createUser({ isAdmin: true });
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await createCrossTrip(author, [groupA.id, groupB.id]);
      const { a, b } = await getSiblings(groupA.id, groupB.id);

      // First check-in: author deletes their own copy — all copies go.
      await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'To be deleted by author' } },
      });
      const authorCopy = await prisma.comment.findFirstOrThrow({ where: { postId: a.id } });
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/comments/${authorCopy.id}`,
        headers: authHeader(author),
      });
      expect(del.statusCode).toBe(200);
      expect(await prisma.comment.count({ where: { postId: { in: [a.id, b.id] } } })).toBe(0);

      // Second check-in: an ADMIN (not the author) deletes one copy — the
      // sibling copy stays (per-group moderation, like admin post deletes).
      await app.inject({
        method: 'POST',
        url: `/api/posts/${a.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'checkin', value: { place: 'Moderated' } },
      });
      const moderatedCopy = await prisma.comment.findFirstOrThrow({ where: { postId: a.id } });
      const adminDel = await app.inject({
        method: 'DELETE',
        url: `/api/comments/${moderatedCopy.id}`,
        headers: authHeader(admin),
      });
      expect(adminDel.statusCode).toBe(200);
      expect(await prisma.comment.count({ where: { postId: a.id } })).toBe(0);
      expect(await prisma.comment.count({ where: { postId: b.id } })).toBe(1);
    });

    it('shows a cross-posted trip once in the feed for a member of both groups', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await createCrossTrip(author, [groupA.id, groupB.id]);

      const feed = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) });
      expect(feed.statusCode).toBe(200);
      const trips = feed.json().items.filter((p: any) => p.type === 'TRIP');
      expect(trips).toHaveLength(1);
      expect(trips[0].trip.title).toBe('Cross trip');
    });
  });
});
