import { z } from 'zod'
import { prisma } from '../../db.js'
import { PostTypeError } from './types.js'
import type { PostTypeHandler } from './types.js'
import {
  GIFT_LIST_CIRCLE_KIND,
  GIFT_LIST_POST_TYPE,
  MAX_GIFT_LIST_PARTICIPANTS,
  isGiftListTypeData,
  normalizeExclusions,
  participantsOf,
  redactGiftListTypeData,
  validateGiftListAudience,
  type GiftListTypeData,
} from '../giftLists.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const giftListSettingsFields = {
  title: z.string().trim().min(1).max(120),
  occasionDate: isoDate.nullable().optional(),
  drawEnabled: z.boolean().optional(),
  budget: z.string().trim().max(40).nullable().optional(),
  exclusions: z
    .array(z.tuple([z.string().min(1), z.string().min(1)]))
    .max(200)
    .optional(),
}

// Client-sent typeData at create time (POST /api/posts, type GIFT_LIST).
// participantUserIds are the OTHER participants; the starter is implicit.
// They become the hidden circle's members (createAudience below) and are
// stripped from the persisted typeData (transformCreate).
const giftListTypeDataSchema = z.object({
  ...giftListSettingsFields,
  participantUserIds: z
    .array(z.string().min(1))
    .max(MAX_GIFT_LIST_PARTICIPANTS - 1)
    .default([]),
})

type ClientGiftListTypeData = z.output<typeof giftListTypeDataSchema>

// A gift list: a title, an optional occasion date and a hand-picked set of
// participants from ONE family, each keeping a wishlist
// (routes/giftLists.ts), with an optional Secret Santa draw. Its audience is
// a hidden circle created alongside the post — see services/giftLists.ts.
export const giftListHandler: PostTypeHandler = {
  id: GIFT_LIST_POST_TYPE,
  typeDataSchema: giftListTypeDataSchema,

  async validateCreate({ typeData, authorId, targetGroupIds }) {
    // Participants come from one family; the hidden circle lives in one group.
    if (targetGroupIds.length !== 1) throw new PostTypeError('giftListNoCrossPost')

    const parsed = typeData as ClientGiftListTypeData
    const error = await validateGiftListAudience(
      targetGroupIds[0],
      participantsOf(authorId, parsed.participantUserIds),
      parsed.exclusions ?? []
    )
    if (error) throw new PostTypeError(error)
  },

  transformCreate(typeData): GiftListTypeData {
    const parsed = typeData as ClientGiftListTypeData
    return {
      title: parsed.title,
      occasionDate: parsed.occasionDate ?? null,
      drawEnabled: parsed.drawEnabled ?? false,
      budget: parsed.budget || null,
      exclusions: normalizeExclusions(parsed.exclusions),
      drawnAt: null,
    }
  },

  async createAudience({ tx, groupId, authorId, typeData }) {
    const parsed = typeData as ClientGiftListTypeData
    const circle = await tx.circle.create({
      data: {
        groupId,
        kind: GIFT_LIST_CIRCLE_KIND,
        name: parsed.title,
        createdById: authorId,
        members: { create: participantsOf(authorId, parsed.participantUserIds).map((userId) => ({ userId })) },
      },
      select: { id: true },
    })
    return circle.id
  },

  // Batch-attaches `giftList` — the participant list, wishlist counts and
  // the VIEWER'S OWN draw assignment only. The full pairing set is never
  // loaded here, let alone returned. Exclusions are configuration only the
  // starter needs (and which, in a small family, narrow down who might have
  // drawn whom), so they're stripped from everyone else's typeData.
  async enrichPosts(posts, viewerId) {
    const circleIds = [...new Set(posts.map((p) => p.circleId).filter((id): id is string => typeof id === 'string'))]
    const postIds = posts.map((p) => p.id)
    const [members, itemCounts, myAssignments] = await Promise.all([
      prisma.circleMember.findMany({
        where: { circleId: { in: circleIds } },
        select: { circleId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.giftListItem.groupBy({ by: ['postId', 'ownerId'], where: { postId: { in: postIds } }, _count: true }),
      prisma.giftDrawAssignment.findMany({
        where: { postId: { in: postIds }, giverId: viewerId },
        select: { postId: true, recipient: { select: { id: true, name: true, avatarUrl: true } } },
      }),
    ])

    for (const post of posts) {
      const typeData = post.typeData
      if (!isGiftListTypeData(typeData)) continue
      const managerId = post.authorId as string
      const participants = members.filter((m) => m.circleId === post.circleId).map((m) => m.user)
      const participantIds = new Set(participants.map((p) => p.id))
      const counts = itemCounts.filter((c) => c.postId === post.id && participantIds.has(c.ownerId))
      const isManager = managerId === viewerId
      const drawn = !!typeData.drawnAt

      post.giftList = {
        title: typeData.title,
        occasionDate: typeData.occasionDate,
        drawEnabled: typeData.drawEnabled,
        budget: typeData.budget,
        drawn,
        drawnAt: typeData.drawnAt,
        managerId,
        isManager,
        participants: participants.map((p) => ({
          ...p,
          itemCount: counts.find((c) => c.ownerId === p.id)?._count ?? 0,
        })),
        itemCount: counts.reduce((n, c) => n + c._count, 0),
        exclusions: isManager ? typeData.exclusions : null,
        myRecipient: drawn ? (myAssignments.find((a) => a.postId === post.id)?.recipient ?? null) : null,
      }
      post.typeData = redactGiftListTypeData(
        { type: GIFT_LIST_POST_TYPE, authorId: managerId, typeData },
        viewerId
      ).typeData
    }
  },
}
