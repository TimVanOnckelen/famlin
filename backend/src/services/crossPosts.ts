import { prisma } from '../db.js'

// Cross-posting gives every target group its own sibling Post row, and each
// sibling keeps its own comments and reactions (a group only ever sees what
// was left in it). But a viewer who belongs to several of a cross-post's
// groups — the author always does — only ever sees ONE sibling in the feed
// (see dedupeByCrossPostId), while a comment/reaction notification
// deep-links to whichever sibling it happened on. Showing per-row activity
// made the same post read differently depending on which copy you landed
// on, so what a member sees of a post's reactions (services/reactions.ts)
// and comments (services/comments.ts) is merged across the siblings they
// can see.
//
// "Can see" = siblings in groups the viewer is currently a member of, so a
// member of only one target group gets exactly that copy's activity and
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

// Every crossPostId on a page of posts → its visible siblings, in one query.
export function visibleSiblingsForPage(posts: { crossPostId: string | null }[], viewerId: string) {
  const crossPostIds = [...new Set(posts.map((p) => p.crossPostId).filter((id): id is string => !!id))]
  return visibleCrossPostSiblingIds(crossPostIds, viewerId)
}

// The post ids whose activity makes up what the viewer sees for this one
// post: just the post itself, or every sibling of a cross-post they can see.
// The post itself always comes first.
export async function visibleSiblingPostIds(
  post: { id: string; crossPostId: string | null },
  viewerId: string
): Promise<string[]> {
  if (!post.crossPostId) return [post.id]
  const ids = (await visibleCrossPostSiblingIds([post.crossPostId], viewerId)).get(post.crossPostId) ?? []
  return [post.id, ...ids.filter((id) => id !== post.id)]
}
