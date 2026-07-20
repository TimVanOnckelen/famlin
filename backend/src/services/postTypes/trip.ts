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
// Checked when the list is written (create/setTravelers) as the "is this a
// valid traveler list" gate; a traveler's isTraveler status at check-in time
// still isn't re-validated against the stored list (removal from the trip
// itself, as opposed to a group, is a deliberate setTravelers edit, not
// membership churn). What DOES change per check-in: which sibling groups
// actually get a Comment copy — see the membership filter in interact()'s
// 'checkin' branch below, which skips a sibling whose group the acting user
// is no longer a member of, rather than trusting this create/setTravelers-time
// check to still hold forever.
async function assertTravelersAreMembers(userIds: string[], groupIds: string[], db: TripDbClient = prisma): Promise<void> {
  if (userIds.length === 0) return;
  const memberships = await db.groupMember.findMany({
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

// Either the top-level PrismaClient or an interactive-transaction client —
// every helper below that issues queries takes one of these so it can run
// either standalone (create-time validation, outside any transaction) or
// inside the interact() transactions below (see lockTripRows).
type TripDbClient = typeof prisma | Prisma.TransactionClient;

// The post ids/groups one trip interaction spans: the post itself for a
// single-group trip, every sibling sharing its crossPostId for a
// cross-posted one. Includes the invoked post.
async function getTripSiblings(
  post: {
    id: string;
    groupId: string;
    groupName: string;
    crossPostId: string | null;
  },
  db: TripDbClient = prisma
): Promise<Array<{ id: string; groupId: string; groupName: string }>> {
  if (!post.crossPostId) {
    return [{ id: post.id, groupId: post.groupId, groupName: post.groupName }];
  }
  const siblings = await db.post.findMany({
    where: { crossPostId: post.crossPostId },
    select: { id: true, groupId: true, group: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  return siblings.map((s) => ({ id: s.id, groupId: s.groupId, groupName: s.group.name }));
}

// Locks every sibling row (or the single post row, for a non-cross-posted
// trip) FOR UPDATE, ordered by id to avoid deadlocking against a concurrent
// interaction on the same trip taking the locks in a different order. Must
// be called inside an interactive transaction — the lock is released when
// that transaction commits/rolls back. Returns the FRESH typeData read
// under the lock, so guards re-run against it instead of the (possibly
// stale) snapshot the route read before the transaction started — see the
// lost-update race this closes in interact() below.
async function lockTripRows(
  tx: Prisma.TransactionClient,
  post: { id: string; crossPostId: string | null }
): Promise<PersistedTripTypeData> {
  const rows = post.crossPostId
    ? await tx.$queryRaw<Array<{ id: string; typeData: PersistedTripTypeData }>>`
        SELECT id, "typeData" FROM "Post" WHERE "crossPostId" = ${post.crossPostId} ORDER BY id FOR UPDATE
      `
    : await tx.$queryRaw<Array<{ id: string; typeData: PersistedTripTypeData }>>`
        SELECT id, "typeData" FROM "Post" WHERE id = ${post.id} ORDER BY id FOR UPDATE
      `;
  const own = rows.find((r) => r.id === post.id) ?? rows[0];
  if (!own) {
    // Data-integrity bug (the invoked post itself vanished mid-transaction)
    // — mirrors the defensive check at the top of interact().
    throw new PostTypeError('invalidInteraction');
  }
  return own.typeData;
}

// Exported so routes/comments.ts (PATCH/DELETE fan-out) and
// subscribers/notifications.ts (routing a check-in to `trip_checkin` instead
// of `new_comment`/`mention`) share this one guard instead of each
// hand-rolling their own `metadata?.kind === 'trip_checkin'` check.
export function isTripCheckinMetadata(value: unknown): value is TripCheckinMetadata {
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

// A future-dated trip (startDate after today, UTC) hasn't begun yet — no
// check-ins are accepted and it isn't "Day 1" in the journal view.
function isTripNotStarted(typeData: PersistedTripTypeData): boolean {
  const todayStr = new Date().toISOString().slice(0, 10);
  return todayStr < typeData.startDate;
}

// null before the trip has started (see isTripNotStarted) — the enriched
// `trip.dayNumber` field is `number | null` precisely for this case, so
// clients already tolerate it (same as the closed-trip null below).
function computeDayNumber(startDate: string): number | null {
  const todayStr = new Date().toISOString().slice(0, 10);
  const diff = daysBetween(startDate, todayStr);
  if (diff < 0) return null;
  return diff + 1;
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
      // Locks the sibling row(s) FOR UPDATE and re-runs every state guard
      // against the freshly-read typeData, then creates the Comment
      // copy/copies in the SAME transaction — closes the lost-update race a
      // bare read-then-write would have against a concurrent close/
      // setTravelers landing between this route's initial read and the
      // write below (see lockTripRows above).
      const { authorizedSiblings, created, primary, metadata } = await prisma.$transaction(async (tx) => {
        const freshTypeData = await lockTripRows(tx, post);

        // The author or any designated co-traveler may check in (the
        // author is implicitly a traveler and never stored in
        // travelerUserIds).
        const isTraveler = post.authorId === userId || (freshTypeData.travelerUserIds ?? []).includes(userId);
        if (!isTraveler) {
          throw new PostTypeError('tripNotTraveler');
        }
        if (isTripClosed(freshTypeData)) {
          throw new PostTypeError('tripClosed');
        }
        if (isTripNotStarted(freshTypeData)) {
          throw new PostTypeError('tripNotStarted');
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

        // A cross-posted trip stores one Comment copy per sibling post
        // (same content/metadata) — but ONLY in a sibling whose group the
        // acting user is STILL a member of. The route only re-checks
        // membership in the invoked post's group (requireGroupMember in
        // routes/posts.ts); a co-traveler who has since been removed from
        // one sibling's group must not get a Comment created in a group
        // they can no longer see. This means a check-in can produce fewer
        // copies than there are siblings — intentional, mirrors how admin
        // content moderation already lets sibling copies diverge. Skipped
        // for a non-cross-posted trip (no crossPostId): its one sibling IS
        // the invoked post, already authorized by the route, so the extra
        // membership query would be pure overhead on the common case.
        const siblings = await getTripSiblings(post, tx);
        let authorizedSiblings = siblings;
        if (post.crossPostId) {
          const memberGroupIds = new Set(
            (
              await tx.groupMember.findMany({
                where: { userId, groupId: { in: siblings.map((sibling) => sibling.groupId) } },
                select: { groupId: true },
              })
            ).map((m) => m.groupId)
          );
          // The invoked post's group is already authorized by the route, so
          // it always gets its copy regardless of the membership query above.
          memberGroupIds.add(post.groupId);
          authorizedSiblings = siblings.filter((sibling) => memberGroupIds.has(sibling.groupId));
        }

        const created = await Promise.all(
          authorizedSiblings.map((sibling) =>
            tx.comment.create({
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
        const invokedIndex = authorizedSiblings.findIndex((sibling) => sibling.id === post.id);
        const primary = created[invokedIndex] ?? created[0];
        return { authorizedSiblings, created, primary, metadata };
      });

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
        checkinTargets: authorizedSiblings.map((sibling, i) => ({
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

      // Locks the sibling row(s) FOR UPDATE and re-checks isTripClosed
      // against the freshly-read typeData before writing — closes the
      // lost-update race where a concurrent close/setTravelers interleaving
      // could otherwise write a stale snapshot back (e.g. resetting
      // closedAt/closedByUserId to null and silently "reopening" the trip).
      await prisma.$transaction(async (tx) => {
        const freshTypeData = await lockTripRows(tx, post);
        if (isTripClosed(freshTypeData)) {
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
        const updated: PersistedTripTypeData = { ...freshTypeData, closedAt: new Date().toISOString(), closedByUserId: userId };
        await tx.post.updateMany({
          where: post.crossPostId ? { crossPostId: post.crossPostId, authorId: post.authorId } : { id: post.id },
          data: { typeData: updated as unknown as Prisma.InputJsonValue },
        });
      });
      return;
    }

    if (key === 'setTravelers') {
      if (post.authorId !== userId) {
        throw new PostTypeError('tripNotAuthor');
      }

      const parsed = setTravelersValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new PostTypeError('invalidInteraction');
      }
      const travelerIds = normalizeTravelerIds(parsed.data.userIds, post.authorId);

      // Locks the sibling row(s) FOR UPDATE and re-checks isTripClosed
      // against the freshly-read typeData before writing — same
      // lost-update race as `close` above (a concurrent close landing
      // between this route's initial read and the write below must not be
      // silently discarded).
      await prisma.$transaction(async (tx) => {
        const freshTypeData = await lockTripRows(tx, post);
        if (isTripClosed(freshTypeData)) {
          throw new PostTypeError('tripClosed');
        }

        // Against EVERY sibling's group — a traveler checks into all of them.
        const siblings = await getTripSiblings(post, tx);
        await assertTravelersAreMembers(
          travelerIds,
          siblings.map((sibling) => sibling.groupId),
          tx
        );

        // Replaces the stored list wholesale — same "handler owns its own
        // typeData" exception and sibling fan-out as `close` above.
        const updated: PersistedTripTypeData = { ...freshTypeData, travelerUserIds: travelerIds };
        await tx.post.updateMany({
          where: post.crossPostId ? { crossPostId: post.crossPostId, authorId: post.authorId } : { id: post.id },
          data: { typeData: updated as unknown as Prisma.InputJsonValue },
        });
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
