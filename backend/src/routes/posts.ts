import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import {
  createPostBodySchema,
  updatePostBodySchema,
  paginationQuerySchema,
  searchPostsQuerySchema,
  parseMediaAssetPath,
} from '../types.js';
import { emitDomainEvent } from '../events.js';
import { isGroupMember, getUserGroupIds } from '../services/groups.js';
import { shapePost, shapePostsWithPeople, attachSharedWithGroups, dedupeByCrossPostId, dropLeadingCrossPostSiblings } from '../services/posts.js';
import { getOnThisDayPosts } from '../services/onThisDay.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { copyMediaAssetsToUploads, CrossPostAssetCopyError } from '../services/media/copyAsset.js';
import { getT } from '../i18n/index.js';

// A post's uploadedAssetUrls can include media proxy URLs (see
// routes/media.ts and the legacy routes/immich.ts) alongside normal
// /uploads/* ones — confirm each one's embedded album link actually belongs
// to *this* post's group, so a member of group A can't attach group B's
// linked album photos to a post in group A.
async function mediaUrlsBelongToGroup(urls: string[] | undefined, groupId: string): Promise<boolean> {
  if (!urls || urls.length === 0) return true;

  const linkIds = [...new Set(urls.map((url) => parseMediaAssetPath(url)?.linkId).filter((id): id is string => !!id))];
  if (linkIds.length === 0) return true;

  const links = await prisma.mediaAlbumLink.findMany({ where: { id: { in: linkIds } } });
  return links.length === linkIds.length && links.every((link) => link.groupId === groupId);
}

const postInclude = (userId: string) => ({
  author: { select: { id: true, name: true, avatarUrl: true } },
  // The feed can span several groups (see the groupIds filter on GET /), so
  // clients need the group's name on each post to label where it belongs.
  group: { select: { id: true, name: true } },
  _count: { select: { comments: true, likes: true } },
  // All reaction rows (not just this user's) so the response can show a
  // per-emoji breakdown, not just a total — see services/reactions.ts.
  // Ordered most-recent-first and carrying the reactor's identity so
  // shapePost can expose recentReactors ("who reacted, not just a count").
  likes: {
    select: { type: true, userId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  favorites: { where: { userId }, select: { id: true } },
});

export default async function postRoutes(fastify: FastifyInstance) {
  // The feed is a filter over the user's groups: `groupIds` (comma-separated)
  // selects a subset, the legacy `groupId` selects one, and neither means
  // every group the user belongs to. Whatever is requested is checked against
  // their memberships — never trust the ids alone.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId, groupIds } = request.query as { groupId?: string; groupIds?: string };

    const requested = groupIds
      ? [...new Set(groupIds.split(',').filter(Boolean))]
      : groupId
        ? [groupId]
        : null;

    const memberGroupIds = await getUserGroupIds(request.user!.id);

    let effectiveGroupIds: string[];
    if (requested) {
      if (requested.length === 0 || requested.some((id) => !memberGroupIds.includes(id))) {
        return reply.status(403).send({ error: t('errors.notGroupMember') });
      }
      effectiveGroupIds = requested;
    } else {
      effectiveGroupIds = memberGroupIds;
    }

    const { cursor, take } = paginationQuerySchema.parse(request.query);

    if (effectiveGroupIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    // A cross-post's sibling rows share createdAt, so createdAt alone isn't a
    // stable order/cursor key — id breaks the tie deterministically for both
    // the page order and the "leading duplicate" check below.
    const posts = await prisma.post.findMany({
      where: { groupId: { in: effectiveGroupIds } },
      include: postInclude(request.user!.id),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(posts, take);

    // A cursor can land in the middle of a cross-post's sibling group (they
    // share createdAt) — drop any of THIS page's leading rows that share the
    // cursor post's crossPostId, since those siblings were already shown on
    // the previous page.
    let deduped = items;
    if (cursor) {
      const cursorPost = await prisma.post.findUnique({ where: { id: cursor }, select: { crossPostId: true } });
      if (cursorPost?.crossPostId) {
        deduped = dropLeadingCrossPostSiblings(deduped, cursorPost.crossPostId);
      }
    }
    deduped = dedupeByCrossPostId(deduped);

    return { items: await shapePostsWithPeople(deduped, request.user!.id), nextCursor };
  });

  // Registered before /:id so "search"/"on-this-day" aren't swallowed by the
  // dynamic :id param route.
  fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId, q, cursor, take } = searchPostsQuerySchema.parse(request.query);

    if (!(await isGroupMember(groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const posts = await prisma.post.findMany({
      where: {
        groupId,
        OR: [
          { content: { contains: q, mode: 'insensitive' } },
          { milestoneTag: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: postInclude(request.user!.id),
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(posts, take);
    return { items: await shapePostsWithPeople(items, request.user!.id), nextCursor };
  });

  fastify.get('/on-this-day', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.query as { groupId?: string };
    if (!groupId) return reply.status(400).send({ error: t('errors.groupIdRequired') });

    if (!(await isGroupMember(groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const posts = await getOnThisDayPosts(groupId);
    if (posts.length === 0) return { items: [] };

    const full = await prisma.post.findMany({
      where: { id: { in: posts.map((p) => p.id) } },
      include: postInclude(request.user!.id),
    });
    const byId = new Map(full.map((p) => [p.id, p]));
    const ordered = posts.map((p) => byId.get(p.id)).filter((p): p is NonNullable<typeof p> => !!p);

    return { items: await shapePostsWithPeople(ordered, request.user!.id) };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({
      where: { id },
      include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
    });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const [shaped] = await shapePostsWithPeople([post], request.user!.id);
    return shaped;
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const body = createPostBodySchema.parse(request.body);

    // Cross-posting: `groupIds` (1–20) fans one write out into one Post row
    // per target group, all sharing a crossPostId — the legacy single
    // `groupId` shape still works unchanged (targets.length === 1 below).
    const targets = [...new Set(body.groupIds ?? [body.groupId!])];

    for (const groupId of targets) {
      if (!(await isGroupMember(groupId, request.user!.id))) {
        return reply.status(403).send({ error: t('errors.notGroupMember') });
      }
    }

    if (targets.length === 1) {
      const groupId = targets[0];

      if (!(await mediaUrlsBelongToGroup(body.uploadedAssetUrls, groupId))) {
        return reply.status(400).send({ error: t('errors.assetNotFoundOnPost') });
      }

      const post = await prisma.post.create({
        data: {
          authorId: request.user!.id,
          groupId,
          content: body.content,
          type: body.type,
          milestoneTag: body.milestoneTag,
          uploadedAssetUrls: body.uploadedAssetUrls || [],
          latitude: body.latitude,
          longitude: body.longitude,
          locationName: body.locationName,
        },
        include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
      });

      // Handlers run fire-and-forget (see events.ts), so fanning out
      // push/email to the group can't hold the response or fail post
      // creation.
      emitDomainEvent('post.created', {
        posts: [{ postId: post.id, groupId: post.group.id, groupName: post.group.name }],
        authorId: request.user!.id,
        authorName: post.author.name,
        content: post.content,
      });

      // people: [] unenriched — a freshly created post can't wait on an
      // Immich person-tag crawl before the client sees its own post; the
      // next feed fetch will carry real tags for it.
      return { ...shapePost(post, request.user!.id), people: [] };
    }

    // Cross-post: a linked-album asset is only readable through the
    // MediaAlbumLink it came from, which belongs to exactly one group — copy
    // each such asset's bytes into a plain /uploads/ file (readable by every
    // target group) before fanning out. mediaUrlsBelongToGroup's per-group
    // check doesn't apply here: copyMediaAssetsToUploads does the equivalent
    // authorization check against every target group instead.
    let assetUrls = body.uploadedAssetUrls ?? [];
    const mediaUrls = assetUrls.filter((url) => parseMediaAssetPath(url) !== null);
    if (mediaUrls.length > 0) {
      try {
        const copied = await copyMediaAssetsToUploads(mediaUrls, targets);
        assetUrls = assetUrls.map((url) => copied.get(url) ?? url);
      } catch (err) {
        if (err instanceof CrossPostAssetCopyError) {
          return reply.status(err.code === 'forbidden' ? 400 : 502).send({ error: t('errors.crossPostAssetCopyFailed') });
        }
        throw err;
      }
    }

    const crossPostId = randomUUID();
    // One shared Date so every sibling's createdAt matches exactly (the feed
    // dedup logic relies on siblings sorting adjacently).
    const createdAt = new Date();

    const createdPosts = await prisma.$transaction(
      targets.map((groupId) =>
        prisma.post.create({
          data: {
            authorId: request.user!.id,
            groupId,
            content: body.content,
            type: body.type,
            milestoneTag: body.milestoneTag,
            uploadedAssetUrls: assetUrls,
            latitude: body.latitude,
            longitude: body.longitude,
            locationName: body.locationName,
            crossPostId,
            createdAt,
          },
          include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
        })
      )
    );

    emitDomainEvent('post.created', {
      posts: createdPosts.map((p) => ({ postId: p.id, groupId: p.group.id, groupName: p.group.name })),
      authorId: request.user!.id,
      authorName: createdPosts[0].author.name,
      content: createdPosts[0].content,
    });

    // The response mirrors the single-group shape (first target group's
    // post), plus sharedWithGroups — this only ever appears for the author,
    // which the creator always is (see the privacy rule on shapePost).
    const first = createdPosts[0];
    return {
      ...shapePost(first, request.user!.id),
      people: [],
      sharedWithGroups: createdPosts.map((p) => ({ id: p.group.id, name: p.group.name })),
    };
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updatePostBodySchema.parse(request.body);

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (post.authorId !== request.user!.id) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    // Editing writes into the group, so it requires *current* membership — a
    // removed member's old posts stay visible but they can't keep editing them.
    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    if (post.crossPostId) {
      // Cross-posted: every sibling shares identical content, so an edit
      // applies to all of them at once. A linked-album asset in the edit
      // must be authorized against every sibling's group, not just this
      // row's own — mirrors the copy step in POST / above.
      const siblingGroupIds = (
        await prisma.post.findMany({ where: { crossPostId: post.crossPostId }, select: { groupId: true } })
      ).map((s) => s.groupId);

      let uploadedAssetUrls = body.uploadedAssetUrls;
      if (uploadedAssetUrls) {
        const mediaUrls = uploadedAssetUrls.filter((url) => parseMediaAssetPath(url) !== null);
        if (mediaUrls.length > 0) {
          try {
            const copied = await copyMediaAssetsToUploads(mediaUrls, siblingGroupIds);
            uploadedAssetUrls = uploadedAssetUrls.map((url) => copied.get(url) ?? url);
          } catch (err) {
            if (err instanceof CrossPostAssetCopyError) {
              return reply.status(err.code === 'forbidden' ? 400 : 502).send({ error: t('errors.crossPostAssetCopyFailed') });
            }
            throw err;
          }
        }
      }

      await prisma.post.updateMany({
        where: { crossPostId: post.crossPostId, authorId: request.user!.id },
        data: {
          content: body.content,
          milestoneTag: body.milestoneTag,
          editedAt: new Date(),
          ...('latitude' in body ? { latitude: body.latitude, longitude: body.longitude, locationName: body.locationName } : {}),
          ...(uploadedAssetUrls ? { uploadedAssetUrls } : {}),
        },
      });

      const current = await prisma.post.findUnique({
        where: { id },
        include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
      });
      const [shaped] = await attachSharedWithGroups(
        [shapePost(current!, request.user!.id)],
        [current!],
        request.user!.id
      );
      // Same reasoning as the non-cross-post branch below — don't make an
      // edit wait on Immich.
      return { ...shaped, people: [] };
    }

    const updated = await prisma.post.update({
      where: { id },
      data: {
        content: body.content,
        milestoneTag: body.milestoneTag,
        editedAt: new Date(),
        ...('latitude' in body ? { latitude: body.latitude, longitude: body.longitude, locationName: body.locationName } : {}),
      },
      include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
    });

    // Same reasoning as POST / above — don't make an edit wait on Immich.
    return { ...shapePost(updated, request.user!.id), people: [] };
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (post.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    // Only the author's OWN delete fans out to every cross-posted sibling.
    // An admin moderating content (post.authorId !== request.user!.id, only
    // reachable via the isAdmin bypass above) always stays single-row and
    // group-scoped — an admin may not even be a member of a sibling's other
    // groups, and moderation is deliberately per-group (see admin.ts).
    if (post.crossPostId && post.authorId === request.user!.id) {
      await prisma.post.deleteMany({ where: { crossPostId: post.crossPostId, authorId: request.user!.id } });
    } else {
      await prisma.post.delete({ where: { id } });
    }

    return { success: true };
  });
}
