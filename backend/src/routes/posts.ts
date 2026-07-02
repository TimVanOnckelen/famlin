import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createPostBodySchema, updatePostBodySchema, paginationQuerySchema } from '../types.js';
import { notifyGroup } from '../services/notifications.js';
import { isGroupMember } from '../services/groups.js';
import { shapePost } from '../services/posts.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { getT } from '../i18n/index.js';

const postInclude = (userId: string) => ({
  author: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { comments: true, likes: true } },
  likes: { where: { userId }, select: { id: true } },
  favorites: { where: { userId }, select: { id: true } },
});

export default async function postRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.query as { groupId?: string };

    if (!groupId) {
      return reply.status(400).send({ error: t('errors.groupIdRequired') });
    }

    if (!(await isGroupMember(groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const posts = await prisma.post.findMany({
      where: { groupId, deletedAt: null },
      include: postInclude(request.user!.id),
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(posts, take);
    return { items: items.map(shapePost), nextCursor };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({
      where: { id },
      include: { ...postInclude(request.user!.id), group: { select: { id: true, name: true } } },
    });

    if (!post || post.deletedAt) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    return shapePost(post);
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const body = createPostBodySchema.parse(request.body);

    if (!(await isGroupMember(body.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
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
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        group: { select: { id: true, name: true } },
      },
    });

    await notifyGroup({
      type: 'new_post',
      groupId: body.groupId,
      senderId: request.user!.id,
      postId: post.id,
      params: { author: post.author.name, group: post.group.name },
    });

    return post;
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updatePostBodySchema.parse(request.body);

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post || post.deletedAt) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (post.authorId !== request.user!.id) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
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

    return shapePost(updated);
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post || post.deletedAt) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (post.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    await prisma.post.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: request.user!.id },
    });

    return { success: true };
  });
}
