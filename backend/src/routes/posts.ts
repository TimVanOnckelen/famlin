import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createPostBodySchema } from '../types.js';
import { notifyGroup } from '../services/notifications.js';

export default async function postRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { groupId } = request.query as { groupId?: string };

    if (!groupId) {
      return reply.status(400).send({ error: 'groupId is required' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: request.user!.id } },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    const posts = await prisma.post.findMany({
      where: { groupId },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { comments: true, likes: true } },
        likes: { where: { userId: request.user!.id }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return posts.map((post) => ({
      ...post,
      commentCount: post._count.comments,
      likeCount: post._count.likes,
      likedByMe: post.likes.length > 0,
    }));
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        group: { select: { id: true, name: true } },
        _count: { select: { comments: true, likes: true } },
        likes: { where: { userId: request.user!.id }, select: { id: true } },
      },
    });

    if (!post) {
      return reply.status(404).send({ error: 'Post not found' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: post.groupId, userId: request.user!.id } },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    return {
      ...post,
      commentCount: post._count.comments,
      likeCount: post._count.likes,
      likedByMe: post.likes.length > 0,
    };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = createPostBodySchema.parse(request.body);

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: body.groupId, userId: request.user!.id } },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    const post = await prisma.post.create({
      data: {
        authorId: request.user!.id,
        groupId: body.groupId,
        content: body.content,
        type: body.type,
        milestoneTag: body.milestoneTag,
        immichAlbumId: body.immichAlbumId,
        immichAssetIds: body.immichAssetIds || [],
        uploadedAssetUrls: body.uploadedAssetUrls || [],
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
      message: `${post.author.name} heeft een nieuw bericht geplaatst in ${post.group.name}`,
    });

    return post;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post) {
      return reply.status(404).send({ error: 'Post not found' });
    }

    if (post.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    await prisma.post.delete({ where: { id } });

    return { success: true };
  });
}
