import { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { emitDomainEvent } from '../events.js'
import { requireGroupMember } from '../plugins/auth.js'
import { getT } from '../i18n/index.js'
import { reactionBodySchema } from '../types.js'
import { mergedPostLikes, mergedReactionCounts, reactionCounts, reactionPostIdsFor } from '../services/reactions.js'
import { isRecordNotFound } from '../utils/prismaErrors.js'
import { canViewPostCircle } from '../services/circles.js'

export default async function likeRoutes(fastify: FastifyInstance) {
  fastify.get('/posts/:postId/reactions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { postId } = request.params as { postId: string }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, groupId: true, circleId: true, crossPostId: true },
    })

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') })
    }

    if (await requireGroupMember(request, reply, post.groupId)) return

    // A circle-private post is invisible to group members outside it — same
    // 404 the post itself returns, so its existence can't be probed here.
    if (!(await canViewPostCircle(post.circleId, request.user!.id))) {
      return reply.status(404).send({ error: t('errors.postNotFound') })
    }

    // A cross-post's reactions are merged across the siblings the caller can
    // see — the same view post responses give, see mergeCrossPostLikes.
    const likes = await mergedPostLikes(await reactionPostIdsFor(post, request.user!.id))

    return { items: likes.map((like) => ({ ...like.user, type: like.type })) }
  })

  fastify.post('/posts/:postId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { postId } = request.params as { postId: string }
    const { type } = reactionBodySchema.parse(request.body ?? {})

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { group: { select: { id: true, name: true } } },
    })

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') })
    }

    if (await requireGroupMember(request, reply, post.groupId)) return

    // A circle-private post is invisible to group members outside it — same
    // 404 the post itself returns, so its existence can't be probed here.
    if (!(await canViewPostCircle(post.circleId, request.user!.id))) {
      return reply.status(404).send({ error: t('errors.postNotFound') })
    }

    // For a cross-post, the caller's reaction is whichever one they left on
    // any sibling they can see (they're shown one merged post, see
    // mergeCrossPostLikes) — so a tap on this copy removes/switches that
    // reaction where it lives rather than adding a second one here.
    const reactionPostIds = await reactionPostIdsFor(post, request.user!.id)
    const existing = await prisma.like.findFirst({
      where: { postId: { in: reactionPostIds }, userId: request.user!.id },
      orderBy: { createdAt: 'desc' },
    })

    let myReaction: string | null

    if (existing && existing.type === type) {
      // Tapping the same reaction again removes it. deleteMany (not delete)
      // keeps a concurrent duplicate tap (double-tap/client retry) that
      // already removed it the idempotent "removed" outcome, not a 500.
      await prisma.like.deleteMany({ where: { postId: { in: reactionPostIds }, userId: request.user!.id } })
      myReaction = null
    } else if (existing) {
      // Switching: change it in place (on whichever sibling it was left), so
      // it stays visible to the group it was left in.
      await prisma.like.updateMany({
        where: { postId: { in: reactionPostIds }, userId: request.user!.id },
        data: { type },
      })
      myReaction = type
    } else {
      // No existing reaction, or switching to a different one — both are
      // upsert-shaped. Using upsert (rather than a separate update/create
      // branch) keeps this atomic under a concurrent double-tap/create race:
      // two requests that both read `existing` as null can no longer both
      // attempt a `create` and have the loser throw P2002.
      await prisma.like.upsert({
        where: { postId_userId: { postId, userId: request.user!.id } },
        create: { postId, userId: request.user!.id, type },
        update: { type },
      })
      myReaction = type
    }

    if (myReaction) {
      emitDomainEvent('reaction.added', {
        targetKind: 'post',
        postId: post.id,
        commentId: null,
        groupId: post.groupId,
        groupName: post.group.name,
        targetAuthorId: post.authorId,
        targetContent: post.content,
        reactorId: request.user!.id,
        reactorName: request.user!.name,
        reactionType: type,
      })
    }

    const counts = await mergedReactionCounts(reactionPostIds)
    return { myReaction, counts }
  })

  fastify.post('/comments/:commentId/like', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { commentId } = request.params as { commentId: string }
    const { type } = reactionBodySchema.parse(request.body ?? {})

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: { include: { group: { select: { id: true, name: true } } } } },
    })

    if (!comment) {
      return reply.status(404).send({ error: t('errors.commentNotFound') })
    }

    if (await requireGroupMember(request, reply, comment.post.groupId)) return

    // A circle-private post is invisible to group members outside it — same
    // 404 the post itself returns, so its existence can't be probed here.
    if (!(await canViewPostCircle(comment.post.circleId, request.user!.id))) {
      return reply.status(404).send({ error: t('errors.postNotFound') })
    }

    const existing = await prisma.like.findUnique({
      where: { commentId_userId: { commentId, userId: request.user!.id } },
    })

    let myReaction: string | null

    if (existing && existing.type === type) {
      // See the postId_userId branch above for why P2025 here is idempotent
      // success rather than an error.
      try {
        await prisma.like.delete({ where: { id: existing.id } })
      } catch (err) {
        if (!isRecordNotFound(err)) throw err
      }
      myReaction = null
    } else {
      // See the postId_userId branch above for why upsert (not
      // update-or-create) is what closes the create/create race.
      await prisma.like.upsert({
        where: { commentId_userId: { commentId, userId: request.user!.id } },
        create: { commentId, userId: request.user!.id, type },
        update: { type },
      })
      myReaction = type
    }

    if (myReaction) {
      emitDomainEvent('reaction.added', {
        targetKind: 'comment',
        postId: comment.post.id,
        commentId: comment.id,
        groupId: comment.post.groupId,
        groupName: comment.post.group.name,
        targetAuthorId: comment.authorId,
        targetContent: comment.content,
        reactorId: request.user!.id,
        reactorName: request.user!.name,
        reactionType: type,
      })
    }

    const counts = await reactionCounts({ commentId })
    return { myReaction, counts }
  })
}
