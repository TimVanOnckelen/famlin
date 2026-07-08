import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import {
  createPostBodySchema,
  updatePostBodySchema,
  paginationQuerySchema,
  searchPostsQuerySchema,
  parseImmichAssetPath,
} from '../types.js';
import { notifyGroup, excerptText } from '../services/notifications.js';
import { isGroupMember, getUserGroupIds } from '../services/groups.js';
import { shapePost } from '../services/posts.js';
import { getOnThisDayPosts } from '../services/onThisDay.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { getT } from '../i18n/index.js';

// A post's uploadedAssetUrls can include Immich proxy URLs (see
// routes/immich.ts) alongside normal /uploads/* ones — confirm each one's
// embedded album link actually belongs to *this* post's group, so a member
// of group A can't attach group B's linked album photos to a post in group A.
async function immichUrlsBelongToGroup(urls: string[] | undefined, groupId: string): Promise<boolean> {
  if (!urls || urls.length === 0) return true;

  const linkIds = [...new Set(urls.map((url) => parseImmichAssetPath(url)?.linkId).filter((id): id is string => !!id))];
  if (linkIds.length === 0) return true;

  const links = await prisma.immichAlbumLink.findMany({ where: { id: { in: linkIds } } });
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

    const posts = await prisma.post.findMany({
      where: { groupId: { in: effectiveGroupIds } },
      include: postInclude(request.user!.id),
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(posts, take);
    return { items: items.map((post) => shapePost(post, request.user!.id)), nextCursor };
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
    return { items: items.map((post) => shapePost(post, request.user!.id)), nextCursor };
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

    return { items: ordered.map((post) => shapePost(post, request.user!.id)) };
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

    return shapePost(post, request.user!.id);
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const body = createPostBodySchema.parse(request.body);

    if (!(await isGroupMember(body.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    if (!(await immichUrlsBelongToGroup(body.uploadedAssetUrls, body.groupId))) {
      return reply.status(400).send({ error: t('errors.assetNotFoundOnPost') });
    }

    const post = await prisma.post.create({
      data: {
        authorId: request.user!.id,
        groupId: body.groupId,
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

    // Fire-and-forget: fanning out push/email to the group shouldn't hold the
    // response (a slow SMTP server would otherwise stall post creation).
    void notifyGroup({
      type: 'new_post',
      groupId: body.groupId,
      senderId: request.user!.id,
      postId: post.id,
      params: { author: post.author.name, group: post.group.name, excerpt: excerptText(post.content) },
    }).catch((err) => request.log.error(err, 'Failed to send post notifications'));

    return shapePost(post, request.user!.id);
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

    return shapePost(updated, request.user!.id);
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

    await prisma.post.delete({ where: { id } });

    return { success: true };
  });
}
