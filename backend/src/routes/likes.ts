import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { notifyUser, excerptText, reactionEmoji } from '../services/notifications.js';
import { isGroupMember } from '../services/groups.js';
import { getT } from '../i18n/index.js';
import { reactionBodySchema } from '../types.js';
import { reactionCounts } from '../services/reactions.js';

export default async function likeRoutes(fastify: FastifyInstance) {
  fastify.post('/posts/:postId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const { type } = reactionBodySchema.parse(request.body ?? {});

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { group: { select: { id: true, name: true } } },
    });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const existing = await prisma.like.findUnique({
      where: { postId_userId: { postId, userId: request.user!.id } },
    });

    let myReaction: string | null;

    if (existing && existing.type === type) {
      // Tapping the same reaction again removes it.
      await prisma.like.delete({ where: { id: existing.id } });
      myReaction = null;
    } else if (existing) {
      // Switching reactions updates the existing row instead of adding a
      // second one — the postId_userId unique constraint is still one
      // reaction per user per post.
      await prisma.like.update({ where: { id: existing.id }, data: { type } });
      myReaction = type;
    } else {
      await prisma.like.create({ data: { postId, userId: request.user!.id, type } });
      myReaction = type;
    }

    if (myReaction && post.authorId !== request.user!.id) {
      void notifyUser({
        type: 'new_like_post',
        userId: post.authorId,
        senderId: request.user!.id,
        postId: post.id,
        params: {
          author: request.user!.name,
          group: post.group.name,
          excerpt: excerptText(post.content),
          emoji: reactionEmoji(type),
        },
      }).catch((err) => request.log.error(err, 'Failed to send like notification'));
    }

    const counts = await reactionCounts({ postId });
    return { myReaction, counts };
  });

  fastify.post('/comments/:commentId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { commentId } = request.params as { commentId: string };
    const { type } = reactionBodySchema.parse(request.body ?? {});

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: { include: { group: { select: { id: true, name: true } } } } },
    });

    if (!comment) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (!(await isGroupMember(comment.post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const existing = await prisma.like.findUnique({
      where: { commentId_userId: { commentId, userId: request.user!.id } },
    });

    let myReaction: string | null;

    if (existing && existing.type === type) {
      await prisma.like.delete({ where: { id: existing.id } });
      myReaction = null;
    } else if (existing) {
      await prisma.like.update({ where: { id: existing.id }, data: { type } });
      myReaction = type;
    } else {
      await prisma.like.create({ data: { commentId, userId: request.user!.id, type } });
      myReaction = type;
    }

    if (myReaction && comment.authorId !== request.user!.id) {
      void notifyUser({
        type: 'new_like_comment',
        userId: comment.authorId,
        senderId: request.user!.id,
        postId: comment.post.id,
        params: {
          author: request.user!.name,
          group: comment.post.group.name,
          excerpt: excerptText(comment.content),
          emoji: reactionEmoji(type),
        },
      }).catch((err) => request.log.error(err, 'Failed to send like notification'));
    }

    const counts = await reactionCounts({ commentId });
    return { myReaction, counts };
  });
}
