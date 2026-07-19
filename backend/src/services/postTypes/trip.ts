import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { emitDomainEvent } from '../../events.js';
import { uploadPathSchema } from '../../types.js';
import { PostTypeError } from './types.js';
import type { PostTypeHandler } from './types.js';

// Client-sent typeData shape at create time (routes/posts.ts POST /). A TRIP
// post's "question"-equivalent (content) stays optional free text — the
// trip's own identity lives here instead. coverPhotoUrl (and a check-in's
// photoUrls, below) reuse the exact /uploads/ path regex uploadedAssetUrls
// validates against, so a trip can never link an arbitrary external URL.
const tripTypeDataSchema = z.object({
  title: z.string().trim().min(1).max(120),
  destination: z.string().trim().max(160).optional(),
  // Plain YYYY-MM-DD (no time component — a trip is date-scoped, not
  // timestamp-scoped). z.string().date() validates that shape.
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  coverPhotoUrl: uploadPathSchema.optional(),
  // Co-travelers: other group members who may also check in. The author is
  // implicitly a traveler and never stored in this list (stripped at
  // create/setTravelers time); each id is validated to be a current member
  // of every target group.
  travelerUserIds: z.array(z.string().min(1)).max(20).optional(),
});

// The persisted shape of Post.typeData for a TRIP post. closedAt/
// closedByUserId start null at creation and are the ONE exception to
// "typeData is immutable after create" in this codebase (see the `close`
// branch of interact() below) — the trip handler owns further writes to its
// own typeData, closing a trip is part of the type's lifecycle, not a post
// edit.
interface PersistedTripTypeData {
  title: string;
  destination: string | null;
  startDate: string;
  endDate: string | null;
  coverPhotoUrl: string | null;
  // Co-travelers (deduplicated, author never included — see
  // normalizeTravelerIds). The one OTHER mutable piece of this typeData
  // besides closedAt/closedByUserId, replaced wholesale by the
  // author-only `setTravelers` interaction.
  travelerUserIds: string[];
  closedAt: string | null;
  closedByUserId: string | null;
}

// The metadata payload stored on a Comment row that represents a check-in
// (Comment.metadata), rather than an ordinary user comment. Only this
// handler ever writes it — the public POST /api/posts/:postId/comments route
// doesn't accept a client-sent `metadata` field (see createCommentBodySchema
// in src/types.ts).
interface TripCheckinMetadata {
  kind: 'trip_checkin';
  // Shared by every Comment copy one check-in creates (one per cross-post
  // sibling; a single-group trip has exactly one copy but still carries the
  // id, for uniformity) — it's what lets the author's DELETE of one copy
  // remove the others too (see routes/comments.ts).
  checkinId: string;
  place: string;
  photoUrls: string[];
}

const checkinValueSchema = z.object({
  place: z.string().trim().min(1).max(80),
  text: z.string().trim().max(2000).optional(),
  photoUrls: z.array(uploadPathSchema).max(10).optional(),
});

const setTravelersValueSchema = z.object({
  userIds: z.array(z.string().min(1)).max(20),
});

// Dedupe and strip the author — the author is implicitly a traveler and is
// never stored in travelerUserIds (so enrichment's `travelers` list never
// duplicates the author, who the UI shows separately).
function normalizeTravelerIds(ids: string[], authorId: string): string[] {
  return [...new Set(ids)].filter((id) => id !== authorId);
}

// Every proposed traveler must be a CURRENT member of EVERY target group —
// a co-traveler's check-ins land in all cross-post sibling groups, and
// members must never create content in a group they don't belong to.
// Checked when the list is written (create/setTravelers), not on every
// check-in: a traveler later removed from a group loses feed access anyway,
// and re-validating the stored list per check-in would silently change past
// behavior.
async function assertTravelersAreMembers(userIds: string[], groupIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const memberships = await prisma.groupMember.findMany({
    where: { groupId: { in: groupIds }, userId: { in: userIds } },
    select: { groupId: true, userId: true },
  });
  const groupsByUserId = new Map<string, Set<string>>();
  for (const m of memberships) {
    const set = groupsByUserId.get(m.userId) ?? new Set<string>();
    set.add(m.groupId);
    groupsByUserId.set(m.userId, set);
  }
  const everyUserInEveryGroup = userIds.every((userId) => {
    const groups = groupsByUserId.get(userId);
    return !!groups && groupIds.every((groupId) => groups.has(groupId));
  });
  if (!everyUserInEveryGroup) {
    throw new PostTypeError('tripTravelerNotMember');
  }
}

// The post ids/groups one trip interaction spans: the post itself for a
// single-group trip, every sibling sharing its crossPostId for a
// cross-posted one. Includes the invoked post.
async function getTripSiblings(post: {
  id: string;
  groupId: string;
  groupName: string;
  crossPostId: string | null;
}): Promise<Array<{ id: string; groupId: string; groupName: string }>> {
  if (!post.crossPostId) {
    return [{ id: post.id, groupId: post.groupId, groupName: post.groupName }];
  }
  const siblings = await prisma.post.findMany({
    where: { crossPostId: post.crossPostId },
    select: { id: true, groupId: true, group: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  return siblings.map((s) => ({ id: s.id, groupId: s.groupId, groupName: s.group.name }));
}

function isTripCheckinMetadata(value: unknown): value is TripCheckinMetadata {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).kind === 'trip_checkin';
}

// Whole-days between two YYYY-MM-DD dates (both parsed as UTC midnight — a
// bare "YYYY-MM-DD" string is UTC per the ECMA-262 Date Time String Format,
// so no local-timezone drift here).
function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

// closed = explicitly closed by the author, OR its endDate's UTC day has
// fully elapsed (auto-close — no interaction required to observe this).
function isTripClosed(typeData: PersistedTripTypeData): boolean {
  if (typeData.closedAt != null) return true;
  if (typeData.endDate == null) return false;
  const endOfDay = new Date(`${typeData.endDate}T23:59:59.999Z`).getTime();
  return Date.now() > endOfDay;
}

function computeDayNumber(startDate: string): number {
  const todayStr = new Date().toISOString().slice(0, 10);
  return Math.max(1, daysBetween(startDate, todayStr) + 1);
}

function computeDurationDays(typeData: PersistedTripTypeData): number | null {
  const endDateStr = typeData.closedAt ? typeData.closedAt.slice(0, 10) : typeData.endDate;
  if (!endDateStr) return null;
  return Math.max(1, daysBetween(typeData.startDate, endDateStr) + 1);
}

// A living travel journal: the author creates it with title/destination/
// dates/cover (plus optional co-travelers), the author or any co-traveler
// adds check-ins (place + optional text + optional photos) while traveling,
// and it closes manually (interact key 'close', author-only) or
// automatically once its endDate has fully elapsed. Check-ins are stored as
// Comment rows with a `metadata` discriminator (see TripCheckinMetadata
// above) rather than a dedicated table, so per-check-in reactions/replies
// ride the existing comment infrastructure for free.
export const tripHandler: PostTypeHandler = {
  id: 'TRIP',

  typeDataSchema: tripTypeDataSchema,

  async validateCreate({ typeData, authorId, targetGroupIds }) {
    const parsed = typeData as z.infer<typeof tripTypeDataSchema>;
    if (parsed.endDate && parsed.endDate < parsed.startDate) {
      throw new PostTypeError('invalidPostTypeData');
    }

    // Co-travelers must be current members of EVERY target group (a
    // cross-posted trip fans their check-ins out to all sibling groups).
    // The author id is stripped before checking — the route already
    // verified the author's own membership in every target.
    const travelerIds = normalizeTravelerIds(parsed.travelerUserIds ?? [], authorId);
    await assertTravelersAreMembers(travelerIds, targetGroupIds);
  },

  transformCreate(typeData, { authorId }): PersistedTripTypeData {
    const parsed = typeData as z.infer<typeof tripTypeDataSchema>;
    return {
      title: parsed.title,
      destination: parsed.destination ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null,
      coverPhotoUrl: parsed.coverPhotoUrl ?? null,
      travelerUserIds: normalizeTravelerIds(parsed.travelerUserIds ?? [], authorId),
      closedAt: null,
      closedByUserId: null,
    };
  },

  async interact({ post, userId, key, value }) {
    const typeData = post.typeData as PersistedTripTypeData | null;
    if (!typeData) {
      // A TRIP post with no typeData would be a data-integrity bug, not a
      // user mistake (mirrors poll.ts's same defensive check) — fail the
      // same way an unknown interaction does rather than throw a 500.
      throw new PostTypeError('invalidInteraction');
    }

    if (key === 'checkin') {
      // The author or any designated co-traveler may check in (the author
      // is implicitly a traveler and never stored in travelerUserIds).
      const isTraveler = post.authorId === userId || (typeData.travelerUserIds ?? []).includes(userId);
      if (!isTraveler) {
        throw new PostTypeError('tripNotTraveler');
      }
      if (isTripClosed(typeData)) {
        throw new PostTypeError('tripClosed');
      }

      const parsed = checkinValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new PostTypeError('invalidInteraction');
      }
      const { place, text, photoUrls } = parsed.data;
      // One shared checkinId across every copy (single-group trips get it
      // too, for uniformity) — see TripCheckinMetadata and the author
      // delete fan-out in routes/comments.ts.
      const metadata: TripCheckinMetadata = { kind: 'trip_checkin', checkinId: randomUUID(), place, photoUrls: photoUrls ?? [] };

      // A cross-posted trip stores one Comment copy per sibling post (same
      // content/metadata), created atomically — comments are group-scoped
      // (they hang off one Post row), so each sibling group needs its own
      // copy to see the check-in, mirroring how cross-posted posts
      // themselves are per-group rows.
      const siblings = await getTripSiblings(post);
      const created = await prisma.$transaction(
        siblings.map((sibling) =>
          prisma.comment.create({
            data: {
              postId: sibling.id,
              authorId: userId,
              content: text ?? '',
              metadata: metadata as unknown as Prisma.InputJsonValue,
            },
            include: { author: { select: { name: true } } },
          })
        )
      );
      const invokedIndex = siblings.findIndex((sibling) => sibling.id === post.id);
      const primary = created[invokedIndex] ?? created[0];

      // ONE comment.created event for the whole check-in, carrying every
      // copy via checkinTargets (mirrors post.created's `posts` array) so
      // the notifications subscriber can notify a member of several sibling
      // groups exactly once — see src/subscribers/notifications.ts.
      // Fire-and-forget like every other domain event emission
      // (src/events.ts); the transaction above already committed.
      emitDomainEvent('comment.created', {
        commentId: primary.id,
        postId: post.id,
        postAuthorId: post.authorId,
        groupId: post.groupId,
        groupName: post.groupName,
        authorId: userId,
        authorName: primary.author.name,
        content: primary.content,
        hasAttachment: metadata.photoUrls.length > 0,
        parentId: null,
        mentionedUserIds: [],
        metadata: primary.metadata,
        checkinTargets: siblings.map((sibling, i) => ({
          commentId: created[i].id,
          postId: sibling.id,
          groupId: sibling.groupId,
          groupName: sibling.groupName,
        })),
      });
      return;
    }

    if (key === 'close') {
      if (post.authorId !== userId) {
        throw new PostTypeError('tripNotAuthor');
      }
      if (isTripClosed(typeData)) {
        throw new PostTypeError('tripClosed');
      }

      // Deliberate exception to "typeData is immutable after create" (see
      // the contract note in ./types.ts) — TRIP is the one type whose own
      // handler owns further writes to its typeData, since closing a trip is
      // part of its lifecycle, not an edit to the post's content. Fans out
      // to every cross-post sibling in one statement (siblings always share
      // identical typeData — created together, and every mutation goes
      // through this same fan-out) — the `{crossPostId, authorId}` where
      // mirrors author PATCH/DELETE in routes/posts.ts.
      const updated: PersistedTripTypeData = { ...typeData, closedAt: new Date().toISOString(), closedByUserId: userId };
      await prisma.post.updateMany({
        where: post.crossPostId ? { crossPostId: post.crossPostId, authorId: post.authorId } : { id: post.id },
        data: { typeData: updated as unknown as Prisma.InputJsonValue },
      });
      return;
    }

    if (key === 'setTravelers') {
      if (post.authorId !== userId) {
        throw new PostTypeError('tripNotAuthor');
      }
      if (isTripClosed(typeData)) {
        throw new PostTypeError('tripClosed');
      }

      const parsed = setTravelersValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new PostTypeError('invalidInteraction');
      }

      const travelerIds = normalizeTravelerIds(parsed.data.userIds, post.authorId);
      // Against EVERY sibling's group — a traveler checks into all of them.
      const siblings = await getTripSiblings(post);
      await assertTravelersAreMembers(
        travelerIds,
        siblings.map((sibling) => sibling.groupId)
      );

      // Replaces the stored list wholesale — same "handler owns its own
      // typeData" exception and sibling fan-out as `close` above.
      const updated: PersistedTripTypeData = { ...typeData, travelerUserIds: travelerIds };
      await prisma.post.updateMany({
        where: post.crossPostId ? { crossPostId: post.crossPostId, authorId: post.authorId } : { id: post.id },
        data: { typeData: updated as unknown as Prisma.InputJsonValue },
      });
      return;
    }

    throw new PostTypeError('invalidInteraction');
  },

  // Batch-attaches the enriched `trip` view to every TRIP post on the page —
  // ONE check-in query + ONE traveler-user query for the whole page (see the
  // ONE-query-per-page contract on PostTypeHandler.enrichPosts), aggregated
  // in JS here.
  async enrichPosts(posts) {
    const checkins = await prisma.comment.findMany({
      where: {
        postId: { in: posts.map((post) => post.id) },
        metadata: { path: ['kind'], equals: 'trip_checkin' },
      },
      select: { id: true, postId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Resolve every trip's co-travelers in one batch query across the page.
    const allTravelerIds = [
      ...new Set(
        posts.flatMap((post) => ((post.typeData as PersistedTripTypeData | null)?.travelerUserIds ?? []) as string[])
      ),
    ];
    const travelerUsers =
      allTravelerIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: allTravelerIds } },
            select: { id: true, name: true, avatarUrl: true },
          })
        : [];
    const travelerById = new Map(travelerUsers.map((user) => [user.id, user]));

    const checkinsByPostId = new Map<string, typeof checkins>();
    for (const checkin of checkins) {
      const list = checkinsByPostId.get(checkin.postId);
      if (list) list.push(checkin);
      else checkinsByPostId.set(checkin.postId, [checkin]);
    }

    for (const post of posts) {
      const typeData = post.typeData as PersistedTripTypeData | null;
      if (!typeData) continue;

      const postCheckins = checkinsByPostId.get(post.id) ?? [];
      const closed = isTripClosed(typeData);

      let photoCount = 0;
      // Built in ascending (oldest-first) check-in order — reverse after
      // slicing so the collage is newest-first.
      const orderedPhotos: string[] = [];
      for (const checkin of postCheckins) {
        if (!isTripCheckinMetadata(checkin.metadata)) continue;
        photoCount += checkin.metadata.photoUrls.length;
        orderedPhotos.push(...checkin.metadata.photoUrls);
      }
      const collagePhotoUrls = orderedPhotos.slice(-3).reverse();

      const latest = postCheckins[postCheckins.length - 1];
      const latestCheckin =
        latest && isTripCheckinMetadata(latest.metadata)
          ? { commentId: latest.id, place: latest.metadata.place, createdAt: latest.createdAt }
          : null;

      // Stored order preserved; a traveler whose account was since deleted
      // simply drops out (user deletion is a hard delete, see CLAUDE.md).
      // The author is never in travelerUserIds, so never duplicated here —
      // the UI shows the author separately.
      const travelers = (typeData.travelerUserIds ?? [])
        .map((id) => travelerById.get(id))
        .filter((user): user is NonNullable<typeof user> => !!user);

      post.trip = {
        title: typeData.title,
        destination: typeData.destination,
        startDate: typeData.startDate,
        endDate: typeData.endDate,
        coverPhotoUrl: typeData.coverPhotoUrl,
        travelers,
        closed,
        closedAt: typeData.closedAt,
        dayNumber: closed ? null : computeDayNumber(typeData.startDate),
        durationDays: closed ? computeDurationDays(typeData) : null,
        stopCount: postCheckins.length,
        photoCount,
        latestCheckin,
        collagePhotoUrls,
      };
    }
  },
};
