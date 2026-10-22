import { prisma } from '../db.js'
import type { ReactionType } from '@prisma/client'

// Used right after a single like/reaction mutation, where only one
// post/comment's counts are needed and a fresh query is cheap and simplest.
export async function reactionCounts(
  target: { postId: string } | { commentId: string }
): Promise<Record<string, number>> {
  const groups = await prisma.like.groupBy({
    by: ['type'],
    where: target,
    _count: { _all: true },
  })
  const counts: Record<string, number> = {}
  for (const g of groups) counts[g.type] = g._count._all
  return counts
}

// Reduces an already-fetched `likes` array (see postInclude/commentInclude)
// into per-type counts + the current user's own reaction, without an extra
// query — used by list endpoints where every reaction row was already loaded.
export function summarizeReactions(likes: { type: ReactionType; userId: string }[], userId: string) {
  const counts: Record<string, number> = {}
  let myReaction: string | null = null
  for (const like of likes) {
    counts[like.type] = (counts[like.type] ?? 0) + 1
    if (like.userId === userId) myReaction = like.type
  }
  return { counts, myReaction }
}

// Cross-posting gives every target group its own sibling Post row, and each
// sibling keeps its own Like rows (a group only ever sees reactions left in
// it). But a viewer who belongs to several of a cross-post's groups — the
// author always does — only ever sees ONE sibling in the feed (see
// dedupeByCrossPostId), while a reaction notification deep-links to whichever
// sibling was reacted to. Showing per-row reactions made the same post read
// differently depending on which copy you landed on, so everything a member
// sees about a post's reactions is merged across the siblings they can see.
//
// "Can see" = siblings in groups the viewer is currently a member of, so a
// member of only one target group gets exactly that copy's reactions and
// learns nothing about the others (the cross-posting privacy rule). Circle
// posts can't be cross-posted; the circleId filter is defensive.
export async function visibleCrossPostSiblingIds(
  crossPostIds: string[],
  viewerId: string
): Promise<Map<string, string[]>> {
  const byCrossPostId = new Map<string, string[]>()
  if (crossPostIds.length === 0) return byCrossPostId
  const siblings = await prisma.post.findMany({
    where: {
      crossPostId: { in: crossPostIds },
      circleId: null,
      group: { members: { some: { userId: viewerId } } },
    },
    select: { id: true, crossPostId: true },
  })
  for (const s of siblings) {
    const list = byCrossPostId.get(s.crossPostId!) ?? []
    list.push(s.id)
    byCrossPostId.set(s.crossPostId!, list)
  }
  return byCrossPostId
}

// The post ids whose reactions make up what the viewer sees for this one
// post: just the post itself, or every sibling of a cross-post they can see.
export async function reactionPostIdsFor(
  post: { id: string; crossPostId: string | null },
  viewerId: string
): Promise<string[]> {
  if (!post.crossPostId) return [post.id]
  const ids = (await visibleCrossPostSiblingIds([post.crossPostId], viewerId)).get(post.crossPostId) ?? []
  return ids.includes(post.id) ? ids : [post.id, ...ids]
}

// Reactions are one per user per post, but a member of several sibling
// groups may have reacted on more than one copy — merged, they count once,
// with their newest reaction. Expects likes ordered newest-first.
function dedupeByUser<L extends { userId: string }>(likes: L[]): L[] {
  const seen = new Set<string>()
  return likes.filter((like) => {
    if (seen.has(like.userId)) return false
    seen.add(like.userId)
    return true
  })
}

const reactorLikeSelect = {
  type: true,
  userId: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
} as const

// Every reaction (newest first, one per user) across the given post ids —
// the merged equivalent of a single post's `likes` relation.
export async function mergedPostLikes(postIds: string[]) {
  const likes = await prisma.like.findMany({
    where: { postId: { in: postIds } },
    select: reactorLikeSelect,
    orderBy: { createdAt: 'desc' },
  })
  return postIds.length > 1 ? dedupeByUser(likes) : likes
}

export async function mergedReactionCounts(postIds: string[]): Promise<Record<string, number>> {
  if (postIds.length === 1) return reactionCounts({ postId: postIds[0] })
  const counts: Record<string, number> = {}
  for (const like of await mergedPostLikes(postIds)) counts[like.type] = (counts[like.type] ?? 0) + 1
  return counts
}

// Replaces each cross-posted post's own `likes`/`_count.likes` with the
// merged view across the siblings the viewer can see, so shapePost's
// reactions/likeCount/myReaction/recentReactors all reflect it. One sibling
// lookup + one Like query for the whole page; posts that aren't cross-posted
// (or whose only visible sibling is themselves) are returned untouched.
export async function mergeCrossPostLikes<
  T extends {
    id: string
    crossPostId: string | null
    _count: { comments: number; likes: number }
    likes: { type: ReactionType; userId: string; user: { id: string; name: string; avatarUrl: string | null } }[]
  },
>(posts: T[], viewerId: string): Promise<T[]> {
  const crossPostIds = [...new Set(posts.map((p) => p.crossPostId).filter((id): id is string => !!id))]
  const siblingIds = await visibleCrossPostSiblingIds(crossPostIds, viewerId)
  const merging = [...siblingIds].filter(([, ids]) => ids.length > 1)
  if (merging.length === 0) return posts

  const likes = await prisma.like.findMany({
    where: { postId: { in: merging.flatMap(([, ids]) => ids) } },
    select: { ...reactorLikeSelect, postId: true },
    orderBy: { createdAt: 'desc' },
  })
  const crossPostIdByPostId = new Map(merging.flatMap(([cpId, ids]) => ids.map((id) => [id, cpId] as const)))
  const likesByCrossPostId = new Map<string, typeof likes>()
  for (const like of likes) {
    const cpId = crossPostIdByPostId.get(like.postId!)!
    const list = likesByCrossPostId.get(cpId) ?? []
    list.push(like)
    likesByCrossPostId.set(cpId, list)
  }

  return posts.map((post) => {
    if (!post.crossPostId || (siblingIds.get(post.crossPostId)?.length ?? 0) <= 1) return post
    const merged = dedupeByUser(likesByCrossPostId.get(post.crossPostId) ?? [])
    return { ...post, likes: merged, _count: { ...post._count, likes: merged.length } }
  })
}
