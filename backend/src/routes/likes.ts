import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { notifyUser } from '../services/notifications.js';
import { isGroupMember } from '../services/groups.js';
import { getT } from '../i18n/index.js';

export default async function likeRoutes(fastify: FastifyInstance) {
  fastify.post('/posts/:postId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { group: { select: { id: true, name: true } } },
    });

    if (!post || post.deletedAt) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const existing = await prisma.like.findUnique({
      where: { postId_userId: { postId, userId: request.user!.id } },
    });

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      return { liked: false };
    }

    await prisma.like.create({
      data: {
        postId,
        userId: request.user!.id,
      },
    });

    if (post.authorId !== request.user!.id) {
      void notifyUser({
        type: 'new_like_post',
        userId: post.authorId,
        senderId: request.user!.id,
        postId: post.id,
        params: { author: request.user!.name, group: post.group.name },
      }).catch((err) => request.log.error(err, 'Failed to send like notification'));
    }

    return { liked: true };
  });

  fastify.post('/comments/:commentId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { commentId } = request.params as { commentId: string };

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: { include: { group: { select: { id: true, name: true } } } } },
    });

    if (!comment || comment.deletedAt || comment.post.deletedAt) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (!(await isGroupMember(comment.post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const existing = await prisma.like.findUnique({
      where: { commentId_userId: { commentId, userId: request.user!.id } },
    });

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      return { liked: false };
    }

    await prisma.like.create({
      data: {
        commentId,
        userId: request.user!.id,
      },
    });

    if (comment.authorId !== request.user!.id) {
      void notifyUser({
        type: 'new_like_comment',
        userId: comment.authorId,
        senderId: request.user!.id,
        postId: comment.post.id,
        params: { author: request.user!.name, group: comment.post.group.name },
      }).catch((err) => request.log.error(err, 'Failed to send like notification'));
    }

    return { liked: true };
  });
}
