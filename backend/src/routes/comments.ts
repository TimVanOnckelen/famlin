import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createCommentBodySchema } from '../types.js';
import { notifyGroup } from '../services/notifications.js';

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.get('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post) {
      return reply.status(404).send({ error: 'Post not found' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: post.groupId, userId: request.user!.id } },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    const comments = await prisma.comment.findMany({
      where: { postId },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return comments;
  });

  fastify.post('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const body = createCommentBodySchema.parse(request.body);

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

    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId: request.user!.id,
        content: body.content,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    await notifyGroup({
      type: 'new_comment',
      groupId: post.groupId,
      senderId: request.user!.id,
      postId: post.id,
      message: `${comment.author.name} reageerde op een bericht in ${post.group.name}`,
    });

    return comment;
  });

  fastify.delete('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const comment = await prisma.comment.findUnique({ where: { id } });

    if (!comment) {
      return reply.status(404).send({ error: 'Comment not found' });
    }

    if (comment.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    await prisma.comment.delete({ where: { id } });

    return { success: true };
  });
}
