import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createCommentBodySchema, updateCommentBodySchema } from '../types.js';
import { notifyUsers } from '../services/notifications.js';
import { isGroupMember } from '../services/groups.js';
import { getT } from '../i18n/index.js';

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.get('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const { assetUrl } = request.query as { assetUrl?: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post || post.deletedAt) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const comments = await prisma.comment.findMany({
      where: {
        postId,
        deletedAt: null,
        ...(assetUrl !== undefined ? { assetUrl } : {}),
        OR: [{ parentId: null }, { parent: { deletedAt: null } }],
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { likes: true } },
        likes: { where: { userId: request.user!.id }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return comments.map((comment) => ({
      ...comment,
      likeCount: comment._count.likes,
      likedByMe: comment.likes.length > 0,
    }));
  });

  fastify.post('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const body = createCommentBodySchema.parse(request.body);

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

    let assetUrl = body.assetUrl;

    if (body.parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: body.parentId } });
      if (!parent || parent.postId !== postId || parent.deletedAt) {
        return reply.status(404).send({ error: t('errors.parentCommentNotFound') });
      }
      // A reply stays attached to whatever the thread it's replying to is
      // pinned to (a specific photo, or the post itself) — the client can't
      // override that.
      assetUrl = parent.assetUrl ?? undefined;
    } else if (assetUrl && !post.uploadedAssetUrls.includes(assetUrl)) {
      return reply.status(400).send({ error: t('errors.assetNotFoundOnPost') });
    }

    // Only the post's author and people already participating in this
    // thread are relevant to a new comment — not the whole group.
    const priorParticipants = await prisma.comment.findMany({
      where: { postId, deletedAt: null },
      select: { authorId: true },
      distinct: ['authorId'],
    });
    const candidateIds = [...new Set([post.authorId, ...priorParticipants.map((c) => c.authorId)])];
    // Narrow to people who are still members of the group — a removed member
    // (even the original author) shouldn't keep getting its activity.
    const members = await prisma.groupMember.findMany({
      where: { groupId: post.groupId, userId: { in: candidateIds } },
      select: { userId: true },
    });
    const recipientIds = members.map((m) => m.userId);

    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId: request.user!.id,
        content: body.content,
        parentId: body.parentId,
        assetUrl,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Fire-and-forget: fanning out push/email shouldn't hold the response (a
    // slow SMTP server would otherwise stall comment creation).
    void notifyUsers({
      type: 'new_comment',
      userIds: recipientIds,
      senderId: request.user!.id,
      postId: post.id,
      params: { author: comment.author.name, group: post.group.name },
    }).catch((err) => request.log.error(err, 'Failed to send comment notifications'));

    return { ...comment, likeCount: 0, likedByMe: false };
  });

  fastify.patch('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updateCommentBodySchema.parse(request.body);

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { post: { select: { groupId: true, deletedAt: true } } },
    });

    if (!comment || comment.deletedAt || comment.post.deletedAt) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (comment.authorId !== request.user!.id) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    // Editing writes into the group, so it requires *current* membership.
    if (!(await isGroupMember(comment.post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const updated = await prisma.comment.update({
      where: { id },
      data: { content: body.content, editedAt: new Date() },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { likes: true } },
        likes: { where: { userId: request.user!.id }, select: { id: true } },
      },
    });

    return {
      ...updated,
      likeCount: updated._count.likes,
      likedByMe: updated.likes.length > 0,
    };
  });

  fastify.delete('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { post: { select: { deletedAt: true } } },
    });

    if (!comment || comment.deletedAt || comment.post.deletedAt) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (comment.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    await prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: request.user!.id },
    });

    return { success: true };
  });
}
