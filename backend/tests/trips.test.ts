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

    it('rejects cross-posting a trip to more than one group', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupIds: [groupA.id, groupB.id],
          content: 'Shared trip',
          type: 'TRIP',
          typeData: { title: 'Shared trip', startDate: isoDate(0) },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("A trip can't be shared to more than one family at once");
      expect(await prisma.post.count({ where: { content: 'Shared trip' } })).toBe(0);
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
      expect(comment.metadata).toEqual({ kind: 'trip_checkin', place: 'Geneva', photoUrls: [photo] });
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
});
