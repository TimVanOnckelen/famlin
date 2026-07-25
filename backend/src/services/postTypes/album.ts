import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { emitDomainEvent } from '../../events.js';
import { uploadPathSchema } from '../../types.js';
import { PostTypeError } from './types.js';
import type { PostTypeHandler } from './types.js';

// Client-sent typeData shape at create time (routes/posts.ts POST /). An
// ALBUM post's own identity is its title (plus an optional cover photo) — the
// human-readable `content` stays an optional free-text description, same as a
// TRIP. coverPhotoUrl reuses the exact /uploads/ path regex uploadedAssetUrls
// validates against, so an album can never link an arbitrary external URL.
const albumTypeDataSchema = z.object({
  title: z.string().trim().min(1).max(120),
  coverPhotoUrl: uploadPathSchema.optional(),
});

// The persisted shape of Post.typeData for an ALBUM post. closedAt/
// closedByUserId start null at creation — like TRIP, ALBUM is a lifecycle
// type whose own handler writes these later (the `close` interaction), a
// documented exception to "typeData is immutable after create" (see the
// contract note in ./types.ts).
interface PersistedAlbumTypeData {
  title: string;
  coverPhotoUrl: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
}

// The metadata payload stored on a Comment row that represents a photo
// contribution (Comment.metadata), rather than an ordinary user comment. Only
// this handler ever writes it — the public POST /api/posts/:postId/comments
// route doesn't accept a client-sent `metadata` field (see
// createCommentBodySchema in src/types.ts), so `metadata.kind` is a
// trustworthy discriminator. The optional caption rides on Comment.content
// (mirrors how a TRIP check-in stores its text), so it stays searchable and
// editable through the normal comment routes.
interface AlbumPhotoMetadata {
  kind: 'album_photo';
  // Shared by every Comment copy one contribution creates (one per cross-post
  // sibling; a single-group album has exactly one copy but still carries the
  // id, for uniformity) — it's what lets the contributor's DELETE/PATCH of one
  // copy fan out to the others (see routes/comments.ts and
  // handlerCommentSiblingKey in ./registry.ts).
  contributionId: string;
  photoUrls: string[];
}

const addPhotosValueSchema = z.object({
  photoUrls: z.array(uploadPathSchema).min(1).max(10),
  caption: z.string().trim().max(2000).optional(),
});

// Either the top-level PrismaClient or an interactive-transaction client, so
// the helpers below run either standalone or inside interact()'s transactions.
type AlbumDbClient = typeof prisma | Prisma.TransactionClient;

// Exported so routes/comments.ts (author edit/delete fan-out via
// handlerCommentSiblingKey) and subscribers/notifications.ts (routing a
// contribution to `album_photo` instead of `new_comment`) share this one
// guard instead of hand-rolling their own `metadata?.kind` check.
export function isAlbumPhotoMetadata(value: unknown): value is AlbumPhotoMetadata {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).kind === 'album_photo';
}

function isAlbumClosed(typeData: PersistedAlbumTypeData): boolean {
  return typeData.closedAt != null;
}

// The post ids/groups one album interaction spans: the post itself for a
// single-group album, every sibling sharing its crossPostId for a
// cross-posted one. Includes the invoked post.
async function getAlbumSiblings(
  post: { id: string; groupId: string; groupName: string; crossPostId: string | null },
  db: AlbumDbClient = prisma
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

// Locks the sibling row(s) FOR UPDATE (ordered by id to avoid deadlocking
// against a concurrent interaction taking the locks in another order) and
// returns the FRESH typeData read under the lock, so guards re-run against it
// instead of the (possibly stale) snapshot the route read before the
// transaction started — closes the same lost-update race trip.ts documents.
async function lockAlbumRows(
  tx: Prisma.TransactionClient,
  post: { id: string; crossPostId: string | null }
): Promise<PersistedAlbumTypeData> {
  const rows = post.crossPostId
    ? await tx.$queryRaw<Array<{ id: string; typeData: PersistedAlbumTypeData }>>`
        SELECT id, "typeData" FROM "Post" WHERE "crossPostId" = ${post.crossPostId} ORDER BY id FOR UPDATE
      `
    : await tx.$queryRaw<Array<{ id: string; typeData: PersistedAlbumTypeData }>>`
        SELECT id, "typeData" FROM "Post" WHERE id = ${post.id} ORDER BY id FOR UPDATE
      `;
  const own = rows.find((r) => r.id === post.id) ?? rows[0];
  if (!own) {
    throw new PostTypeError('invalidInteraction');
  }
  return own.typeData;
}

// A collaborative photo album: the author creates it with a title (and an
// optional cover), then ANY member of the post's group adds photos to it
// (interact key 'addPhotos') — not just the author, the whole point of the
// type. It closes manually (interact key 'close', author-only), after which no
// more photos can be added. Contributions are stored as Comment rows with a
// `metadata` discriminator (see AlbumPhotoMetadata above) rather than a
// dedicated table, so per-contribution reactions/replies ride the existing
// comment infrastructure for free — exactly like a TRIP check-in.
export const albumHandler: PostTypeHandler = {
  id: 'ALBUM',

  typeDataSchema: albumTypeDataSchema,

  transformCreate(typeData): PersistedAlbumTypeData {
    const parsed = typeData as z.infer<typeof albumTypeDataSchema>;
    return {
      title: parsed.title,
      coverPhotoUrl: parsed.coverPhotoUrl ?? null,
      closedAt: null,
      closedByUserId: null,
    };
  },

  async interact({ post, userId, key, value }) {
    const typeData = post.typeData as PersistedAlbumTypeData | null;
    if (!typeData) {
      // An ALBUM post with no typeData would be a data-integrity bug, not a
      // user mistake (mirrors poll/trip's same defensive check) — fail the
      // same way an unknown interaction does rather than throw a 500.
      throw new PostTypeError('invalidInteraction');
    }

    if (key === 'addPhotos') {
      const parsed = addPhotosValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new PostTypeError('invalidInteraction');
      }
      const { photoUrls, caption } = parsed.data;

      // Locks the sibling row(s) FOR UPDATE and re-checks isAlbumClosed
      // against the freshly-read typeData, then creates the Comment
      // copy/copies in the SAME transaction — closes the lost-update race a
      // bare read-then-write would have against a concurrent close landing
      // between the route's initial read and the write below.
      const { authorizedSiblings, created, primary, metadata } = await prisma.$transaction(async (tx) => {
        const freshTypeData = await lockAlbumRows(tx, post);
        if (isAlbumClosed(freshTypeData)) {
          throw new PostTypeError('albumClosed');
        }

        // One shared contributionId across every copy (single-group albums
        // get it too, for uniformity) — see AlbumPhotoMetadata and the
        // contributor edit/delete fan-out in routes/comments.ts.
        const metadata: AlbumPhotoMetadata = { kind: 'album_photo', contributionId: randomUUID(), photoUrls };

        // A cross-posted album stores one Comment copy per sibling post (same
        // content/metadata) — but ONLY in a sibling whose group the acting
        // user is STILL a member of. The route only re-checks membership in
        // the invoked post's group (requireGroupMember in routes/posts.ts); a
        // contributor since removed from one sibling's group must not get a
        // Comment created there. Mirrors trip.ts's checkin fan-out exactly.
        const siblings = await getAlbumSiblings(post, tx);
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
          memberGroupIds.add(post.groupId);
          authorizedSiblings = siblings.filter((sibling) => memberGroupIds.has(sibling.groupId));
        }

        const created = await Promise.all(
          authorizedSiblings.map((sibling) =>
            tx.comment.create({
              data: {
                postId: sibling.id,
                authorId: userId,
                content: caption ?? '',
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

      // ONE comment.created event for the whole contribution, carrying every
      // copy via checkinTargets (the generic "comment copies" list, despite
      // its trip-era name) so the notifications subscriber can notify a member
      // of several sibling groups exactly once — see subscribers/
      // notifications.ts. Fire-and-forget; the transaction already committed.
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
        throw new PostTypeError('albumNotAuthor');
      }

      // Locks the sibling row(s) FOR UPDATE and re-checks isAlbumClosed
      // against the freshly-read typeData before writing — closes the
      // lost-update race a concurrent close would otherwise cause.
      await prisma.$transaction(async (tx) => {
        const freshTypeData = await lockAlbumRows(tx, post);
        if (isAlbumClosed(freshTypeData)) {
          throw new PostTypeError('albumClosed');
        }

        // Deliberate exception to "typeData is immutable after create" (see
        // ./types.ts), same as TRIP's close — fans out to every cross-post
        // sibling in one statement (siblings always share identical typeData);
        // the `{crossPostId, authorId}` where mirrors author PATCH/DELETE in
        // routes/posts.ts.
        const updated: PersistedAlbumTypeData = {
          ...freshTypeData,
          closedAt: new Date().toISOString(),
          closedByUserId: userId,
        };
        await tx.post.updateMany({
          where: post.crossPostId ? { crossPostId: post.crossPostId, authorId: post.authorId } : { id: post.id },
          data: { typeData: updated as unknown as Prisma.InputJsonValue },
        });
      });
      return;
    }

    throw new PostTypeError('invalidInteraction');
  },

  // Batch-attaches the enriched `album` view to every ALBUM post on the page —
  // ONE contribution query for the whole page, aggregated in JS here (see the
  // ONE-query-per-page contract on PostTypeHandler.enrichPosts).
  async enrichPosts(posts) {
    const contributions = await prisma.comment.findMany({
      where: {
        postId: { in: posts.map((post) => post.id) },
        metadata: { path: ['kind'], equals: 'album_photo' },
      },
      select: {
        id: true,
        postId: true,
        metadata: true,
        createdAt: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
      // Oldest first, so we can build a newest-first collage by reversing.
      orderBy: { createdAt: 'asc' },
    });

    const contributionsByPostId = new Map<string, typeof contributions>();
    for (const contribution of contributions) {
      const list = contributionsByPostId.get(contribution.postId);
      if (list) list.push(contribution);
      else contributionsByPostId.set(contribution.postId, [contribution]);
    }

    for (const post of posts) {
      const typeData = post.typeData as PersistedAlbumTypeData | null;
      if (!typeData) continue;

      const postContributions = contributionsByPostId.get(post.id) ?? [];

      let photoCount = 0;
      // Built in ascending (oldest-first) contribution order — reverse after
      // slicing so the collage is newest-first.
      const orderedPhotos: string[] = [];
      const contributorsById = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
      for (const contribution of postContributions) {
        if (!isAlbumPhotoMetadata(contribution.metadata)) continue;
        photoCount += contribution.metadata.photoUrls.length;
        orderedPhotos.push(...contribution.metadata.photoUrls);
        // Keep the LAST occurrence, so contributors ends up newest-first after
        // reversing below.
        contributorsById.delete(contribution.author.id);
        contributorsById.set(contribution.author.id, contribution.author);
      }
      const collagePhotoUrls = orderedPhotos.slice(-6).reverse();
      const contributors = [...contributorsById.values()].reverse().slice(0, 8);

      const latest = postContributions[postContributions.length - 1];
      const latestContribution = latest
        ? { commentId: latest.id, contributorName: latest.author.name, createdAt: latest.createdAt }
        : null;

      post.album = {
        title: typeData.title,
        coverPhotoUrl: typeData.coverPhotoUrl,
        closed: isAlbumClosed(typeData),
        closedAt: typeData.closedAt,
        photoCount,
        contributorCount: contributorsById.size,
        contributors,
        collagePhotoUrls,
        latestContribution,
      };
    }
  },
};
