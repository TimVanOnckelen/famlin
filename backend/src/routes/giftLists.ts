import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { emitDomainEvent } from '../events.js'
import { getT } from '../i18n/index.js'
import { uploadPathSchema } from '../types.js'
import { bindAssetsToScope } from '../services/uploads.js'
import { getUserGroupIds } from '../services/groups.js'
import { visiblePostsWhereFor } from '../services/circles.js'
import { postInclude, shapePostsWithPeople } from '../services/posts.js'
import { giftListSettingsFields } from '../services/postTypes/giftList.js'
import {
  GIFT_LIST_POST_TYPE,
  MAX_GIFT_LIST_PARTICIPANTS,
  MAX_ITEMS_PER_WISHLIST,
  MIN_DRAW_PARTICIPANTS,
  computeDraw,
  getParticipantIds,
  lockGiftListPost,
  normalizeExclusions,
  participantsOf,
  saveGiftList,
  sameExclusions,
  storeDraw,
  validateGiftListAudience,
  type GiftListTypeData,
  type LockedGiftList,
} from '../services/giftLists.js'

// Gift lists (issue #307): wishlists and the Secret Santa draw of a GIFT_LIST
// post. The post itself is created/read/deleted through /api/posts like any
// other type; everything that changes a list after creation lives here.
//
// Visibility is the post's hidden circle (services/giftLists.ts): every
// route below 404s — never 403s — for anyone who isn't a participant, the
// same "can't even probe it" rule Family Circles follow.
//
// SECRECY: the only draw data any response carries is the CALLER's own
// recipient (giftList.myRecipient, from the post type's enrichPosts). No
// route returns, logs or counts the full pairing set — keep it that way.

const itemUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((url) => /^https?:\/\//i.test(url), 'http(s) only')

const createItemBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).nullable().optional(),
  url: itemUrlSchema.nullable().optional(),
  photoUrl: uploadPathSchema.nullable().optional(),
})

const updateItemBodySchema = createItemBodySchema.partial()

const reorderBodySchema = z.object({ itemIds: z.array(z.string().min(1)).max(MAX_ITEMS_PER_WISHLIST) })

const updateSettingsBodySchema = z.object({
  title: giftListSettingsFields.title.optional(),
  occasionDate: giftListSettingsFields.occasionDate,
  drawEnabled: giftListSettingsFields.drawEnabled,
  budget: giftListSettingsFields.budget,
  exclusions: giftListSettingsFields.exclusions,
  // Required (true) for a change that would discard an existing draw.
  confirmRedraw: z.boolean().optional(),
})

const setParticipantsBodySchema = z.object({
  // Everyone besides the starter, who is always a participant.
  userIds: z
    .array(z.string().min(1))
    .max(MAX_GIFT_LIST_PARTICIPANTS - 1)
    .optional()
    .default([]),
  confirmRedraw: z.boolean().optional(),
})

// An expected, user-facing failure thrown from inside a transaction so it
// rolls back; mapped to `status` + t(`errors.${code}`).
class GiftListError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code)
  }
}

interface GiftListPost {
  id: string
  authorId: string
  groupId: string
  circleId: string
}

// Every route's guard: the gift list, when the caller is one of its
// participants and still in its family. Otherwise it sends the 404 itself
// (and, with managerOnly, a 403 to a participant who isn't the starter) and
// returns null — the requireGroupMember pattern.
async function loadGiftList(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { managerOnly?: boolean } = {}
): Promise<GiftListPost | null> {
  const t = getT(request)
  const userId = request.user!.id
  const { postId } = request.params as { postId: string }
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      type: GIFT_LIST_POST_TYPE,
      circle: { members: { some: { userId } } },
      group: { members: { some: { userId } } },
    },
    select: { id: true, authorId: true, groupId: true, circleId: true },
  })
  if (!post?.circleId) {
    reply.status(404).send({ error: t('errors.giftListNotFound') })
    return null
  }
  if (opts.managerOnly && post.authorId !== userId) {
    reply.status(403).send({ error: t('errors.giftListNotManager') })
    return null
  }
  return { ...post, circleId: post.circleId }
}

// Runs `fn` under the post's row lock. A GiftListError thrown inside rolls
// the transaction back and is sent as its translated response (returns false
// so the route stops); anything else propagates to the global handler.
async function inLockedTransaction(
  request: FastifyRequest,
  reply: FastifyReply,
  postId: string,
  fn: (tx: Prisma.TransactionClient, locked: LockedGiftList) => Promise<void>
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await lockGiftListPost(tx, postId)
      if (!locked) throw new GiftListError('giftListNotFound', 404)
      await fn(tx, locked)
    })
    return true
  } catch (err) {
    if (!(err instanceof GiftListError)) throw err
    reply.status(err.status).send({ error: getT(request)(`errors.${err.code}`) })
    return false
  }
}

async function shapedGiftList(postId: string, viewerId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: postInclude(viewerId) })
  const [shaped] = await shapePostsWithPeople([post!], viewerId)
  return shaped
}

export default async function giftListRoutes(fastify: FastifyInstance) {
  // "My gift lists": every gift list the caller participates in, across all
  // their families, newest occasion first (lists without a date sort by
  // creation). Deliberately not cursor-paginated: sorting on a typeData
  // field can't be expressed as a keyset cursor, and a person is in a
  // handful of gift lists a year — capped instead.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user!.id
    const groupIds = await getUserGroupIds(userId)
    if (groupIds.length === 0) return { items: [] }

    const posts = await prisma.post.findMany({
      where: { AND: [await visiblePostsWhereFor(groupIds, userId), { type: GIFT_LIST_POST_TYPE }] },
      include: postInclude(userId),
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const sortKey = (post: (typeof posts)[number]) =>
      (post.typeData as GiftListTypeData | null)?.occasionDate ?? post.createdAt.toISOString().slice(0, 10)
    posts.sort((a, b) => sortKey(b).localeCompare(sortKey(a)))

    return { items: await shapePostsWithPeople(posts, userId) }
  })

  // Every participant's wishlist — everyone sees everyone's, the wisher
  // included (there's no claiming to hide). Items of someone who's no longer
  // a participant are left out even if a cleanup hasn't removed them yet.
  fastify.get('/:postId/items', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const list = await loadGiftList(request, reply)
    if (!list) return

    const items = await prisma.giftListItem.findMany({
      where: { postId: list.id, ownerId: { in: await getParticipantIds(list) } },
      orderBy: [{ ownerId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    })
    return { items }
  })

  fastify.post('/:postId/items', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id
    const body = createItemBodySchema.parse(request.body)
    const list = await loadGiftList(request, reply)
    if (!list) return

    const existing = await prisma.giftListItem.aggregate({
      where: { postId: list.id, ownerId: userId },
      _count: true,
      _max: { position: true },
    })
    if (existing._count >= MAX_ITEMS_PER_WISHLIST) {
      return reply.status(400).send({ error: getT(request)('errors.giftListTooManyItems') })
    }

    const item = await prisma.giftListItem.create({
      data: {
        postId: list.id,
        ownerId: userId,
        title: body.title,
        note: body.note || null,
        url: body.url || null,
        photoUrl: body.photoUrl ?? null,
        position: (existing._max.position ?? -1) + 1,
      },
    })
    // Readable by the list's participants only, like the list itself.
    await bindAssetsToScope([item.photoUrl], { groupIds: [list.groupId], circleId: list.circleId }, userId)

    emitDomainEvent('giftList.itemAdded', { postId: list.id, ownerId: userId, ownerName: request.user!.name })
    return item
  })

  fastify.patch('/:postId/items/:itemId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id
    const { itemId } = request.params as { itemId: string }
    const body = updateItemBodySchema.parse(request.body)
    const list = await loadGiftList(request, reply)
    if (!list) return

    // Only your own wishes — anyone else's is "not found" for editing.
    const item = await prisma.giftListItem.findFirst({ where: { id: itemId, postId: list.id, ownerId: userId } })
    if (!item) return reply.status(404).send({ error: getT(request)('errors.giftListItemNotFound') })

    const updated = await prisma.giftListItem.update({
      where: { id: itemId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...('note' in body ? { note: body.note || null } : {}),
        ...('url' in body ? { url: body.url || null } : {}),
        ...('photoUrl' in body ? { photoUrl: body.photoUrl ?? null } : {}),
      },
    })
    await bindAssetsToScope([body.photoUrl], { groupIds: [list.groupId], circleId: list.circleId }, userId)
    return updated
  })

  fastify.delete('/:postId/items/:itemId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const list = await loadGiftList(request, reply)
    if (!list) return

    const { count } = await prisma.giftListItem.deleteMany({
      where: { id: itemId, postId: list.id, ownerId: request.user!.id },
    })
    if (count === 0) return reply.status(404).send({ error: getT(request)('errors.giftListItemNotFound') })
    return { success: true }
  })

  // Reorders the caller's own wishlist: `itemIds` must be exactly their
  // items, in the new order.
  fastify.put('/:postId/items/order', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id
    const { itemIds } = reorderBodySchema.parse(request.body)
    const list = await loadGiftList(request, reply)
    if (!list) return

    const own = await prisma.giftListItem.findMany({
      where: { postId: list.id, ownerId: userId },
      select: { id: true },
    })
    const ownIds = new Set(own.map((i) => i.id))
    if (
      itemIds.length !== ownIds.size ||
      new Set(itemIds).size !== itemIds.length ||
      !itemIds.every((id) => ownIds.has(id))
    ) {
      return reply.status(400).send({ error: getT(request)('errors.giftListInvalidOrder') })
    }

    await prisma.$transaction(
      itemIds.map((id, position) => prisma.giftListItem.update({ where: { id }, data: { position } }))
    )
    const items = await prisma.giftListItem.findMany({
      where: { postId: list.id, ownerId: userId },
      orderBy: { position: 'asc' },
    })
    return { items }
  })

  // Starter-only settings. Turning the draw off or changing exclusions after
  // the draw discards it — refused with 409 giftDrawWillReset unless
  // confirmRedraw is set; then it redraws (or, with the draw turned off,
  // simply clears it).
  fastify.patch('/:postId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = updateSettingsBodySchema.parse(request.body)
    const list = await loadGiftList(request, reply, { managerOnly: true })
    if (!list) return

    let redrawn = false
    const ok = await inLockedTransaction(request, reply, list.id, async (tx, locked) => {
      const current = locked.typeData
      const exclusions = body.exclusions ? normalizeExclusions(body.exclusions) : current.exclusions
      if (body.exclusions) {
        const error = await validateGiftListAudience(list.groupId, await getParticipantIds(list, tx), exclusions, tx)
        if (error) throw new GiftListError(error)
      }

      const next: GiftListTypeData = {
        ...current,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...('occasionDate' in body ? { occasionDate: body.occasionDate ?? null } : {}),
        ...(body.drawEnabled !== undefined ? { drawEnabled: body.drawEnabled } : {}),
        ...('budget' in body ? { budget: body.budget || null } : {}),
        exclusions,
      }

      const affectsDraw =
        next.drawEnabled !== current.drawEnabled || !sameExclusions(next.exclusions, current.exclusions)
      if (current.drawnAt && affectsDraw && !body.confirmRedraw) throw new GiftListError('giftDrawWillReset', 409)

      const outcome = await saveGiftList(tx, list.id, list, next, { redraw: affectsDraw })
      // Turning the draw off clears it; new exclusions that make every draw
      // impossible are refused instead of silently dropping it.
      if (outcome === 'reset' && next.drawEnabled) throw new GiftListError('giftDrawImpossible')
      redrawn = outcome === 'drawn'

      if (next.title !== current.title) {
        await tx.circle.update({ where: { id: list.circleId }, data: { name: next.title } })
      }
    })
    if (!ok) return

    if (redrawn) emitDomainEvent('giftList.drawn', { postId: list.id, actorId: request.user!.id })
    return shapedGiftList(list.id, request.user!.id)
  })

  // Starter-only: replaces the participant set (the starter always stays
  // in). Removed participants lose their wishes and their exclusions. A
  // change after the draw needs confirmRedraw (409 giftDrawWillReset
  // otherwise) and then redraws from scratch — or clears the draw when it
  // no longer qualifies (fewer than 3 people, impossible exclusions).
  fastify.put('/:postId/participants', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id
    const body = setParticipantsBodySchema.parse(request.body)
    const list = await loadGiftList(request, reply, { managerOnly: true })
    if (!list) return

    const wanted = participantsOf(userId, body.userIds)
    let added: string[] = []
    let redrawn = false
    const ok = await inLockedTransaction(request, reply, list.id, async (tx, locked) => {
      // Checked under the lock; getParticipantIds re-checks the family too,
      // so a family removal racing this can't leave a non-member in the draw.
      const error = await validateGiftListAudience(list.groupId, wanted, [], tx)
      if (error) throw new GiftListError(error)

      const before = await getParticipantIds(list, tx)
      const removed = before.filter((id) => !wanted.includes(id))
      added = wanted.filter((id) => !before.includes(id))
      if (removed.length === 0 && added.length === 0) return
      if (locked.typeData.drawnAt && !body.confirmRedraw) throw new GiftListError('giftDrawWillReset', 409)

      if (removed.length > 0) {
        await tx.circleMember.deleteMany({ where: { circleId: list.circleId, userId: { in: removed } } })
        await tx.giftListItem.deleteMany({ where: { postId: list.id, ownerId: { in: removed } } })
      }
      if (added.length > 0) {
        await tx.circleMember.createMany({
          data: added.map((id) => ({ circleId: list.circleId, userId: id })),
          skipDuplicates: true,
        })
      }
      redrawn = (await saveGiftList(tx, list.id, list, locked.typeData)) === 'drawn'
    })
    if (!ok) return

    if (added.length > 0) {
      emitDomainEvent('giftList.participantsAdded', {
        postId: list.id,
        actorId: userId,
        actorName: request.user!.name,
        userIds: added,
      })
    }
    if (redrawn) emitDomainEvent('giftList.drawn', { postId: list.id, actorId: userId })
    return shapedGiftList(list.id, userId)
  })

  // Starter-only: draws the names, once.
  fastify.post('/:postId/draw', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const list = await loadGiftList(request, reply, { managerOnly: true })
    if (!list) return

    const ok = await inLockedTransaction(request, reply, list.id, async (tx, locked) => {
      const current = locked.typeData
      if (!current.drawEnabled) throw new GiftListError('giftDrawDisabled')
      if (current.drawnAt) throw new GiftListError('giftAlreadyDrawn', 409)

      const participantIds = await getParticipantIds(list, tx)
      if (participantIds.length < MIN_DRAW_PARTICIPANTS) throw new GiftListError('giftDrawTooFewParticipants')
      const draw = computeDraw(participantIds, current.exclusions)
      if (!draw) throw new GiftListError('giftDrawImpossible')
      await storeDraw(tx, list.id, current, draw)
    })
    if (!ok) return

    emitDomainEvent('giftList.drawn', { postId: list.id, actorId: request.user!.id })
    return shapedGiftList(list.id, request.user!.id)
  })

  // A participant leaves on their own. The starter can't (they delete the
  // list instead, via DELETE /api/posts/:id). An active draw is redone
  // without them, or cleared when it no longer qualifies.
  fastify.delete('/:postId/participants/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id
    const list = await loadGiftList(request, reply)
    if (!list) return
    if (list.authorId === userId) {
      return reply.status(400).send({ error: getT(request)('errors.giftListManagerCannotLeave') })
    }

    let redrawn = false
    const ok = await inLockedTransaction(request, reply, list.id, async (tx, locked) => {
      await tx.circleMember.deleteMany({ where: { circleId: list.circleId, userId } })
      await tx.giftListItem.deleteMany({ where: { postId: list.id, ownerId: userId } })
      redrawn = (await saveGiftList(tx, list.id, list, locked.typeData)) === 'drawn'
    })
    if (!ok) return

    if (redrawn) emitDomainEvent('giftList.drawn', { postId: list.id, actorId: userId })
    return { success: true }
  })
}
