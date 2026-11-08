import { z } from 'zod'
import { prisma } from '../../db.js'
import { PostTypeError } from './types.js'
import type { PostTypeHandler } from './types.js'
import { visibleSiblingPostIds, visibleSiblingsForPage } from '../crossPosts.js'
import { isUniqueConstraintViolation } from '../../utils/prismaErrors.js'

// Client-sent typeData shape at create time (routes/posts.ts POST /). The
// event's title lives in `content` — not here — so search, notification
// previews, and old clients keep rendering an event as a plain text post.
// Datetimes may carry an offset; transformCreate normalizes them to UTC.
const eventTypeDataSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  rsvpDeadline: z.string().datetime({ offset: true }).optional(),
})

// The persisted shape of Post.typeData for an EVENT post.
interface PersistedEventTypeData {
  startsAt: string
  endsAt: string | null
  location: string | null
  rsvpDeadline: string | null
}

const RSVP_RESPONSES = ['yes', 'maybe', 'no'] as const
type RsvpResponse = (typeof RSVP_RESPONSES)[number]

function isRsvpResponse(value: unknown): value is RsvpResponse {
  return typeof value === 'string' && (RSVP_RESPONSES as readonly string[]).includes(value)
}

// RSVPs close at the deadline, or when the event starts if there is none.
function isEventClosed(typeData: PersistedEventTypeData): boolean {
  return new Date(typeData.rsvpDeadline ?? typeData.startsAt).getTime() < Date.now()
}

// RSVPs are one PostInteraction row per user (key 'rsvp', value 'yes' |
// 'maybe' | 'no'), public to the post's audience like poll votes, and follow
// the poll/reaction toggle semantics: the same answer again clears it, a
// different one switches it.
//
// Cross-posting is allowed (one gathering can span several families). Each
// sibling keeps its own RSVP rows, and what a viewer sees is merged across
// the siblings they can see — the same rule as reactions and comments (see
// services/crossPosts.ts) — plus, unlike reactions, answers from this
// copy's own family members left on other copies (see enrichPosts). The
// author gets the full guest list, every family sees all of its own members'
// answers, and a member of one family learns nothing about the others.
export const eventHandler: PostTypeHandler = {
  id: 'EVENT',

  typeDataSchema: eventTypeDataSchema,

  validateCreate({ content, typeData }) {
    if (!content?.trim()) {
      throw new PostTypeError('eventTitleRequired')
    }
    const parsed = typeData as z.infer<typeof eventTypeDataSchema>
    const startsAt = new Date(parsed.startsAt).getTime()
    if (parsed.endsAt && new Date(parsed.endsAt).getTime() < startsAt) {
      throw new PostTypeError('eventEndsBeforeStart')
    }
    if (parsed.rsvpDeadline && new Date(parsed.rsvpDeadline).getTime() > startsAt) {
      throw new PostTypeError('eventDeadlineAfterStart')
    }
  },

  transformCreate(typeData): PersistedEventTypeData {
    const parsed = typeData as z.infer<typeof eventTypeDataSchema>
    const toUtc = (iso: string | undefined) => (iso ? new Date(iso).toISOString() : null)
    return {
      startsAt: new Date(parsed.startsAt).toISOString(),
      endsAt: toUtc(parsed.endsAt),
      location: parsed.location ?? null,
      rsvpDeadline: toUtc(parsed.rsvpDeadline),
    }
  },

  async interact({ post, userId, key, value }) {
    if (key !== 'rsvp' || !isRsvpResponse(value)) {
      throw new PostTypeError('invalidInteraction')
    }

    const typeData = post.typeData as PersistedEventTypeData | null
    if (!typeData) {
      throw new PostTypeError('invalidInteraction')
    }

    if (isEventClosed(typeData)) {
      throw new PostTypeError('eventClosed')
    }

    // A member of several target groups answers once per event, not once per
    // sibling, and enrichPosts shows them that one answer on every copy they
    // can see — so the toggle has to look across those same copies, or
    // clearing from a copy that doesn't hold the row would re-create it.
    const copyIds = await visibleSiblingPostIds(post, userId)

    const answer = () =>
      prisma.$transaction(async (tx) => {
        const current = await tx.postInteraction.findMany({
          where: { userId, key: 'rsvp', postId: { in: copyIds } },
          select: { value: true },
        })

        if (current.some((row) => row.value === value)) {
          await tx.postInteraction.deleteMany({ where: { userId, key: 'rsvp', postId: { in: copyIds } } })
          return
        }

        await tx.postInteraction.deleteMany({
          where: { userId, key: 'rsvp', postId: { in: copyIds.filter((id) => id !== post.id) } },
        })
        await tx.postInteraction.upsert({
          where: { postId_userId_key: { postId: post.id, userId, key: 'rsvp' } },
          create: { postId: post.id, userId, key: 'rsvp', value },
          update: { value },
        })
      })

    // Two simultaneous answers (a double tap) can both miss the row and race
    // to create it; the loser retries once and then sees the winner's row.
    try {
      await answer()
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err
      await answer()
    }
  },

  // Batch-attaches the enriched `event` view. A copy shows the answers left
  // on every copy the viewer can see, plus answers left on any other copy by
  // members of THIS copy's family — so a family's guest list includes its
  // own members wherever they answered, while still revealing nothing about
  // the other families. Shaped posts no longer carry crossPostId (it's never
  // serialized), so this looks it up first; five queries per page in total,
  // independent of page size.
  async enrichPosts(posts, viewerId) {
    const postIds = posts.map((post) => post.id)
    const rows = await prisma.post.findMany({
      where: { id: { in: postIds } },
      select: { id: true, crossPostId: true, groupId: true },
    })
    const rowById = new Map(rows.map((row) => [row.id, row]))
    const visibleSiblings = await visibleSiblingsForPage(rows, viewerId)

    const crossPostIds = [...new Set(rows.map((row) => row.crossPostId).filter((id): id is string => !!id))]
    const allSiblings = crossPostIds.length
      ? await prisma.post.findMany({
          where: { crossPostId: { in: crossPostIds } },
          select: { id: true, crossPostId: true },
        })
      : []
    const allSiblingIds = new Map<string, string[]>()
    for (const sibling of allSiblings) {
      const list = allSiblingIds.get(sibling.crossPostId!) ?? []
      list.push(sibling.id)
      allSiblingIds.set(sibling.crossPostId!, list)
    }

    const rsvps = await prisma.postInteraction.findMany({
      where: { postId: { in: [...new Set([...postIds, ...allSiblings.map((s) => s.id)])] }, key: 'rsvp' },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      // Oldest first, so each answer's list is in reply order.
      orderBy: { createdAt: 'asc' },
    })

    const rsvpsByPostId = new Map<string, typeof rsvps>()
    for (const rsvp of rsvps) {
      const list = rsvpsByPostId.get(rsvp.postId)
      if (list) list.push(rsvp)
      else rsvpsByPostId.set(rsvp.postId, [rsvp])
    }

    // Which respondents belong to which of the page's families.
    const memberships = await prisma.groupMember.findMany({
      where: {
        groupId: { in: [...new Set(rows.map((row) => row.groupId))] },
        userId: { in: [...new Set(rsvps.map((r) => r.userId))] },
      },
      select: { groupId: true, userId: true },
    })
    const isMember = new Set(memberships.map((m) => `${m.groupId}:${m.userId}`))

    for (const post of posts) {
      const typeData = post.typeData as PersistedEventTypeData | null
      if (!typeData) continue
      const row = rowById.get(post.id)
      const visible = new Set([post.id, ...(row?.crossPostId ? (visibleSiblings.get(row.crossPostId) ?? []) : [])])
      const copies = row?.crossPostId ? (allSiblingIds.get(row.crossPostId) ?? [post.id]) : [post.id]

      // Keyed by user so a duplicate across siblings (a race with the
      // cleanup in interact) still counts once.
      const byUser = new Map<string, (typeof rsvps)[number]>()
      for (const id of copies) {
        for (const rsvp of rsvpsByPostId.get(id) ?? []) {
          if (visible.has(id) || (row && isMember.has(`${row.groupId}:${rsvp.userId}`))) byUser.set(rsvp.userId, rsvp)
        }
      }

      const responses: Record<RsvpResponse, Array<{ id: string; name: string; avatarUrl: string | null }>> = {
        yes: [],
        maybe: [],
        no: [],
      }
      const shown = [...byUser.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      for (const rsvp of shown) {
        if (isRsvpResponse(rsvp.value)) responses[rsvp.value].push(rsvp.user)
      }
      const mine = byUser.get(viewerId)?.value

      post.event = {
        startsAt: typeData.startsAt,
        endsAt: typeData.endsAt,
        location: typeData.location,
        rsvpDeadline: typeData.rsvpDeadline,
        closed: isEventClosed(typeData),
        myRsvp: isRsvpResponse(mine) ? mine : null,
        counts: { yes: responses.yes.length, maybe: responses.maybe.length, no: responses.no.length },
        responses,
      }
    }
  },
}
