import { randomInt } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { emitDomainEvent } from '../events.js'

// Gift lists (issue #307): a GIFT_LIST post whose audience is a hidden,
// system-managed Circle (Circle.kind = GIFT_LIST_CIRCLE_KIND) holding exactly
// its participants. Reusing Circle is deliberate: every read path that
// already composes visiblePostsWhere(), every notification filtered by
// filterRecipientsByCircle(), every upload bound to the circle and every
// admin content exclusion fails CLOSED for gift lists without knowing they
// exist. See services/postTypes/giftList.ts for the post type itself and
// routes/giftLists.ts for the wishlist/draw endpoints.

export const GIFT_LIST_CIRCLE_KIND = 'GIFT_LIST'
export const GIFT_LIST_POST_TYPE = 'GIFT_LIST'

// Upper bound on participants — keeps the draw and the detail page cheap.
export const MAX_GIFT_LIST_PARTICIPANTS = 50
export const MIN_DRAW_PARTICIPANTS = 3
export const MAX_ITEMS_PER_WISHLIST = 100

// The persisted shape of Post.typeData for a GIFT_LIST post. Like TRIP and
// ALBUM, a lifecycle type whose own routes keep writing typeData after
// creation (settings edits, drawnAt) — always under a row lock, see
// lockGiftListPost below. Participants are NOT stored here: they are the
// members of the post's hidden circle.
export interface GiftListTypeData {
  title: string
  // Plain YYYY-MM-DD, like a trip's dates.
  occasionDate: string | null
  drawEnabled: boolean
  // Free text ("€25", "about 30 dollars") — currencies vary per family.
  budget: string | null
  // Symmetric pairs that may not draw each other, each stored sorted.
  exclusions: Array<[string, string]>
  drawnAt: string | null
}

export type GiftListError = 'giftListParticipantNotMember' | 'giftListInvalidExclusion'

export function isGiftListTypeData(value: unknown): value is GiftListTypeData {
  return !!value && typeof value === 'object' && typeof (value as GiftListTypeData).title === 'string'
}

// Exclusions are the starter's configuration — and in a small family they
// narrow down who might have drawn whom — so every surface but the starter's
// own gets them stripped: the post enrichment, the member export and the
// admin moderation views.
export function redactGiftListTypeData<T extends { type: string; authorId: string; typeData: unknown }>(
  post: T,
  viewerId: string
): T {
  if (post.type !== GIFT_LIST_POST_TYPE || post.authorId === viewerId || !isGiftListTypeData(post.typeData)) {
    return post
  }
  return { ...post, typeData: { ...post.typeData, exclusions: [] } }
}

// The participants: the starter plus the chosen others, deduplicated.
export function participantsOf(authorId: string, otherIds: string[]): string[] {
  return [authorId, ...new Set(otherIds.filter((id) => id !== authorId))]
}

// Sorts each pair, drops self-pairs and duplicates — a {a,b} exclusion is the
// same thing as {b,a}.
export function normalizeExclusions(pairs: Array<[string, string]> | undefined): Array<[string, string]> {
  const seen = new Set<string>()
  const out: Array<[string, string]> = []
  for (const [a, b] of pairs ?? []) {
    if (a === b) continue
    const pair: [string, string] = a < b ? [a, b] : [b, a]
    const key = pair.join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(pair)
  }
  return out
}

// Both sides must already be normalized (as stored ones always are).
export function sameExclusions(a: Array<[string, string]>, b: Array<[string, string]>): boolean {
  const key = (pairs: Array<[string, string]>) =>
    pairs
      .map((p) => p.join('|'))
      .sort()
      .join(',')
  return key(a) === key(b)
}

// Validates a participant set and exclusions against the family: every
// participant must be a member of `groupId`, every exclusion must pair two
// participants. Shared by creation (the post type handler) and the starter's
// later edits (routes/giftLists.ts).
export async function validateGiftListAudience(
  groupId: string,
  participantIds: string[],
  exclusions: Array<[string, string]>,
  db: Db = prisma
): Promise<GiftListError | null> {
  const members = await db.groupMember.count({ where: { groupId, userId: { in: participantIds } } })
  if (members !== participantIds.length) return 'giftListParticipantNotMember'
  const participantSet = new Set(participantIds)
  if (exclusions.some(([a, b]) => !participantSet.has(a) || !participantSet.has(b))) return 'giftListInvalidExclusion'
  return null
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Computes a Secret Santa draw: a map giver -> recipient where everybody
// gives exactly once, receives exactly once, never draws themselves and
// never draws someone they're excluded with (exclusions are symmetric).
// Returns null when no such assignment exists.
//
// Strategy: a bounded number of uniformly random permutations first
// (rejection sampling — every valid draw is equally likely when it
// succeeds, which it almost always does at family scale with a few
// exclusions), then a randomized bipartite matching (Kuhn's augmenting
// paths over shuffled adjacency lists) as a polynomial fallback that also
// decides impossibility exactly, so a tight exclusion set can never hang
// the request. `attempts` is only lowered by tests, to reach the fallback.
export function computeDraw(
  participantIds: string[],
  exclusions: Array<[string, string]>,
  attempts = 2000
): Map<string, string> | null {
  const ids = [...new Set(participantIds)]
  if (ids.length < 2) return null

  const excluded = new Set<string>()
  for (const [a, b] of exclusions) {
    excluded.add(`${a}|${b}`)
    excluded.add(`${b}|${a}`)
  }
  const allowed = (giver: string, recipient: string) => giver !== recipient && !excluded.has(`${giver}|${recipient}`)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const perm = shuffle(ids)
    if (ids.every((giver, i) => allowed(giver, perm[i]))) {
      return new Map(ids.map((giver, i) => [giver, perm[i]]))
    }
  }

  const givers = shuffle(ids)
  const adjacency = new Map(givers.map((g) => [g, shuffle(ids.filter((r) => allowed(g, r)))]))
  const recipientOwner = new Map<string, string>()

  const tryAssign = (giver: string, visited: Set<string>): boolean => {
    for (const recipient of adjacency.get(giver)!) {
      if (visited.has(recipient)) continue
      visited.add(recipient)
      const owner = recipientOwner.get(recipient)
      if (owner === undefined || tryAssign(owner, visited)) {
        recipientOwner.set(recipient, giver)
        return true
      }
    }
    return false
  }

  for (const giver of givers) {
    if (!tryAssign(giver, new Set())) return null
  }
  return new Map([...recipientOwner.entries()].map(([recipient, giver]) => [giver, recipient]))
}

type Db = typeof prisma | Prisma.TransactionClient

// The current participants: circle members who are STILL in the family. The
// family check makes the draw, the item reads and the notifications immune
// to a circle row that outlives a family removal racing a participant edit.
export async function getParticipantIds(
  list: { circleId: string; groupId: string },
  db: Db = prisma
): Promise<string[]> {
  const members = await db.circleMember.findMany({
    where: { circleId: list.circleId, user: { groupMemberships: { some: { groupId: list.groupId } } } },
    select: { userId: true },
    orderBy: { joinedAt: 'asc' },
  })
  return members.map((m) => m.userId)
}

export interface LockedGiftList {
  typeData: GiftListTypeData
  circleId: string
  groupId: string
}

// Locks the gift list's Post row FOR UPDATE and returns its fresh state, so
// concurrent draws / participant changes / settings edits serialize instead
// of interleaving (the same lost-update guard trip.ts uses).
export async function lockGiftListPost(tx: Prisma.TransactionClient, postId: string): Promise<LockedGiftList | null> {
  const rows = await tx.$queryRaw<Array<{ typeData: unknown; circleId: string | null; groupId: string }>>`
    SELECT "typeData", "circleId", "groupId" FROM "Post" WHERE id = ${postId} AND type = ${GIFT_LIST_POST_TYPE} FOR UPDATE
  `
  const row = rows[0]
  if (!row?.circleId || !isGiftListTypeData(row.typeData)) return null
  return { typeData: row.typeData, circleId: row.circleId, groupId: row.groupId }
}

async function writeTypeData(tx: Prisma.TransactionClient, postId: string, typeData: GiftListTypeData): Promise<void> {
  await tx.post.update({ where: { id: postId }, data: { typeData: typeData as unknown as Prisma.InputJsonValue } })
}

export async function storeDraw(
  tx: Prisma.TransactionClient,
  postId: string,
  typeData: GiftListTypeData,
  draw: Map<string, string>
): Promise<void> {
  await tx.giftDrawAssignment.createMany({
    data: [...draw.entries()].map(([giverId, recipientId]) => ({ postId, giverId, recipientId })),
  })
  await writeTypeData(tx, postId, { ...typeData, drawnAt: new Date().toISOString() })
}

export type SaveOutcome = 'drawn' | 'reset' | 'unchanged'

// Persists `next` after a change to the list (settings, participants, someone
// leaving). Exclusions naming someone who's no longer a participant are
// dropped. When the names were drawn, the old draw is thrown away and, when
// the list still qualifies (draw enabled, enough participants, a valid
// assignment exists), drawn again from scratch. Must run inside the
// transaction holding lockGiftListPost's lock.
// Returns 'drawn' when a fresh draw was stored (callers notify every
// participant), 'reset' when the old draw was discarded without a new one.
export async function saveGiftList(
  tx: Prisma.TransactionClient,
  postId: string,
  list: { circleId: string; groupId: string },
  next: GiftListTypeData,
  // false = a change that leaves the draw valid (title, date, budget): keep it.
  { redraw = true }: { redraw?: boolean } = {}
): Promise<SaveOutcome> {
  const participantIds = await getParticipantIds(list, tx)
  const participantSet = new Set(participantIds)
  const typeData = {
    ...next,
    exclusions: next.exclusions.filter(([a, b]) => participantSet.has(a) && participantSet.has(b)),
  }
  if (!typeData.drawnAt || !redraw) {
    await writeTypeData(tx, postId, typeData)
    return 'unchanged'
  }

  await tx.giftDrawAssignment.deleteMany({ where: { postId } })
  const draw =
    typeData.drawEnabled && participantIds.length >= MIN_DRAW_PARTICIPANTS
      ? computeDraw(participantIds, typeData.exclusions)
      : null
  if (!draw) {
    await writeTypeData(tx, postId, { ...typeData, drawnAt: null })
    return 'reset'
  }
  await storeDraw(tx, postId, typeData, draw)
  return 'drawn'
}

// Called by every path that removes someone from a family or deletes their
// account — collect BEFORE the removal, act after it via
// afterGiftListParticipantsRemoved(). `started` are the lists they started:
// with no hand-over, those go (account deletion cascades them anyway; a
// family removal deletes them explicitly). `joined` are the lists they only
// participate in, whose draws need redoing.
export async function giftListsOfUser(
  userId: string,
  groupId?: string
): Promise<{ started: string[]; joined: string[] }> {
  const posts = await prisma.post.findMany({
    where: {
      type: GIFT_LIST_POST_TYPE,
      ...(groupId ? { groupId } : {}),
      circle: { kind: GIFT_LIST_CIRCLE_KIND, members: { some: { userId } } },
    },
    select: { id: true, authorId: true },
  })
  return {
    started: posts.filter((p) => p.authorId === userId).map((p) => p.id),
    joined: posts.filter((p) => p.authorId !== userId).map((p) => p.id),
  }
}

export async function afterGiftListParticipantsRemoved(
  lists: { started: string[]; joined: string[] },
  actorId: string
): Promise<void> {
  if (lists.started.length > 0) await prisma.post.deleteMany({ where: { id: { in: lists.started } } })
  await deleteOrphanedGiftListCircles()

  for (const postId of lists.joined) {
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await lockGiftListPost(tx, postId)
      if (!locked) return 'unchanged' as const
      const participantIds = await getParticipantIds(locked, tx)
      await tx.giftListItem.deleteMany({ where: { postId, ownerId: { notIn: participantIds } } })
      return saveGiftList(tx, postId, locked, locked.typeData)
    })
    if (outcome === 'drawn') emitDomainEvent('giftList.drawn', { postId, actorId })
  }
}

// A gift list's hidden circle exists only for its one post. Post deletion
// (author, admin, or cascading from a deleted user) can't cascade "upwards"
// to it, so callers sweep orphans afterwards — cheap, and correct no matter
// which path deleted the post.
export async function deleteOrphanedGiftListCircles(): Promise<void> {
  await prisma.circle.deleteMany({ where: { kind: GIFT_LIST_CIRCLE_KIND, posts: { none: {} } } })
}
