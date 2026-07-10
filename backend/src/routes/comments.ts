import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createCommentBodySchema, updateCommentBodySchema } from '../types.js';
import { emitDomainEvent } from '../events.js';
import { isGroupMember } from '../services/groups.js';
import { shapeComment } from '../services/comments.js';
import { getT } from '../i18n/index.js';

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.get('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const { assetUrl } = request.query as { assetUrl?: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const comments = await prisma.comment.findMany({
      where: {
        postId,
        ...(assetUrl !== undefined ? { assetUrl } : {}),
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { likes: true } },
        likes: { select: { type: true, userId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return comments.map((comment) => shapeComment(comment, request.user!.id));
  });

  fastify.post('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const body = createCommentBodySchema.parse(request.body);

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

    let assetUrl = body.assetUrl;

    if (body.parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: body.parentId } });
      if (!parent || parent.postId !== postId) {
        return reply.status(404).send({ error: t('errors.parentCommentNotFound') });
      }
      // A reply stays attached to whatever the thread it's replying to is
      // pinned to (a specific photo, or the post itself) — the client can't
      // override that.
      assetUrl = parent.assetUrl ?? undefined;
    } else if (assetUrl && !post.uploadedAssetUrls.includes(assetUrl)) {
      return reply.status(400).send({ error: t('errors.assetNotFoundOnPost') });
    }

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

    // Handlers run fire-and-forget (see events.ts) — the notifications
    // subscriber decides who in the thread gets told (and re-validates the
    // client-supplied mention ids against current group membership).
    emitDomainEvent('comment.created', {
      commentId: comment.id,
      postId: post.id,
      postAuthorId: post.authorId,
      groupId: post.groupId,
      groupName: post.group.name,
      authorId: request.user!.id,
      authorName: comment.author.name,
      content: comment.content,
      parentId: comment.parentId,
      mentionedUserIds: body.mentionedUserIds ?? [],
    });

    return { ...comment, likeCount: 0, likedByMe: false, myReaction: null, reactions: {} };
  });

  fastify.patch('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updateCommentBodySchema.parse(request.body);

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { post: { select: { groupId: true } } },
    });

    if (!comment) {
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
        likes: { select: { type: true, userId: true } },
      },
    });

    return shapeComment(updated, request.user!.id);
  });

  fastify.delete('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const comment = await prisma.comment.findUnique({ where: { id } });

    if (!comment) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (comment.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    await prisma.comment.delete({ where: { id } });

    return { success: true };
  });
}
