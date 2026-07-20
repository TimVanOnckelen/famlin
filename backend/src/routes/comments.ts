import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createCommentBodySchema, updateCommentBodySchema } from '../types.js';
import { emitDomainEvent } from '../events.js';
import { requireGroupMember } from '../plugins/auth.js';
import { shapeComment } from '../services/comments.js';
import { getT } from '../i18n/index.js';
import { isTripCheckinMetadata } from '../services/postTypes/trip.js';

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.get('/posts/:postId/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };
    const { assetUrl } = request.query as { assetUrl?: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (await requireGroupMember(request, reply, post.groupId)) return;

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

    if (await requireGroupMember(request, reply, post.groupId)) return;

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
        content: body.content?.trim() ?? '',
        parentId: body.parentId,
        assetUrl,
        attachmentUrl: body.attachmentUrl,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { likes: true } },
        likes: { select: { type: true, userId: true } },
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
      hasAttachment: !!comment.attachmentUrl,
      parentId: comment.parentId,
      mentionedUserIds: body.mentionedUserIds ?? [],
      // Always null here — the public route's body schema doesn't accept a
      // client-sent metadata field (see createCommentBodySchema in types.ts).
      metadata: comment.metadata,
    });

    // A brand new comment has no likes yet, so this is the same shape as the
    // hand-built { likeCount: 0, likedByMe: false, myReaction: null,
    // reactions: {} } object it replaces — just routed through the same
    // shapeComment every other comment-returning endpoint uses.
    return shapeComment(comment, request.user!.id);
  });

  fastify.patch('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updateCommentBodySchema.parse(request.body);

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { post: { select: { groupId: true, crossPostId: true } } },
    });

    if (!comment) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (comment.authorId !== request.user!.id) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    // Editing writes into the group, so it requires *current* membership.
    if (await requireGroupMember(request, reply, comment.post.groupId)) return;

    const editedAt = new Date();

    // A TRIP check-in on a cross-posted trip exists as one Comment copy per
    // sibling post, all sharing metadata.checkinId (services/postTypes/
    // trip.ts). This route is already author-only (see the check above), so
    // editing one copy must fan the SAME content out to every sibling copy
    // (INCLUDING this one, via one updateMany) — otherwise the check-in's
    // text diverges across groups. Mirrors the author-delete fan-out below.
    if (isTripCheckinMetadata(comment.metadata) && comment.post.crossPostId) {
      const checkinId = comment.metadata.checkinId;
      const siblingIds = (
        await prisma.post.findMany({ where: { crossPostId: comment.post.crossPostId }, select: { id: true } })
      ).map((p) => p.id);
      await prisma.comment.updateMany({
        where: {
          postId: { in: siblingIds },
          authorId: comment.authorId,
          metadata: { path: ['checkinId'], equals: checkinId },
        },
        data: { content: body.content, editedAt },
      });
    } else {
      await prisma.comment.update({
        where: { id },
        data: { content: body.content, editedAt },
      });
    }

    const updated = await prisma.comment.findUniqueOrThrow({
      where: { id },
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

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { post: { select: { crossPostId: true } } },
    });

    if (!comment) {
      return reply.status(404).send({ error: t('errors.commentNotFound') });
    }

    if (comment.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    // A TRIP check-in on a cross-posted trip exists as one Comment copy per
    // sibling post, all sharing metadata.checkinId (services/postTypes/
    // trip.ts). When the AUTHOR deletes their check-in, remove every copy —
    // mirroring how an author's post DELETE fans out to siblings
    // (routes/posts.ts). An admin moderating someone else's check-in stays
    // per-group (single row), consistent with admin post moderation.
    if (comment.authorId === request.user!.id && isTripCheckinMetadata(comment.metadata) && comment.post.crossPostId) {
      const checkinId = comment.metadata.checkinId;
      const siblingIds = (
        await prisma.post.findMany({ where: { crossPostId: comment.post.crossPostId }, select: { id: true } })
      ).map((p) => p.id);
      await prisma.comment.deleteMany({
        where: {
          postId: { in: siblingIds },
          authorId: comment.authorId,
          metadata: { path: ['checkinId'], equals: checkinId },
        },
      });
    } else {
      await prisma.comment.delete({ where: { id } });
    }

    return { success: true };
  });
}
