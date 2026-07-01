import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { notifyGroup } from '../services/notifications.js';

export default async function likeRoutes(fastify: FastifyInstance) {
  fastify.post('/posts/:postId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { group: { select: { id: true, name: true } } },
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
      await notifyGroup({
        type: 'new_like',
        groupId: post.groupId,
        senderId: request.user!.id,
        postId: post.id,
        message: `Iemand vindt je bericht in ${post.group.name} leuk`,
      });
    }

    return { liked: true };
  });
}
