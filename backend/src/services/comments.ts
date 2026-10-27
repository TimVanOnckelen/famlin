import type { Prisma, ReactionType } from '@prisma/client'
import { prisma } from '../db.js'
import { summarizeReactions } from './reactions.js'
import { handlerCommentSiblingKey } from './postTypes/registry.js'

// Shared response shape for a comment — mirrors services/posts.ts shapePost.
export function shapeComment<
  T extends {
    _count: { likes: number }
    likes: { type: ReactionType; userId: string }[]
  },
>(comment: T, userId: string) {
  const { _count, likes, ...rest } = comment
  const { counts, myReaction } = summarizeReactions(likes, userId)
  return {
    ...rest,
    likeCount: _count.likes,
    likedByMe: myReaction !== null,
    myReaction,
    reactions: counts,
  }
}

// A TRIP check-in or ALBUM photo contribution on a cross-post is already
// written once per sibling post, every copy sharing one correlation id (see
// handlerCommentSiblingKey). Merging siblings' comments (see
// services/crossPosts.ts) would list it once per copy, so keep exactly one:
// the primary post's own copy when it has one (so the trip/album views and
// any reply target it), else the first. Replies to a dropped copy are
// re-parented onto the kept one.
export function dedupeHandlerCommentCopies<
  C extends { id: string; postId: string; parentId: string | null; metadata: unknown },
>(comments: C[], primaryPostId: string): C[] {
  const keyOf = (c: C) => {
    const key = handlerCommentSiblingKey(c.metadata)
    return key ? `${key.path.join('.')}:${key.value}` : null
  }
  const keptByKey = new Map<string, string>()
  for (const primaryFirst of [true, false]) {
    for (const c of comments) {
      if ((c.postId === primaryPostId) !== primaryFirst) continue
      const key = keyOf(c)
      if (key && !keptByKey.has(key)) keptByKey.set(key, c.id)
    }
  }
  const replacedBy = new Map<string, string>()
  for (const c of comments) {
    const key = keyOf(c)
    if (key && keptByKey.get(key) !== c.id) replacedBy.set(c.id, keptByKey.get(key)!)
  }
  if (replacedBy.size === 0) return comments
  return comments
    .filter((c) => !replacedBy.has(c.id))
    .map((c) => (c.parentId && replacedBy.has(c.parentId) ? { ...c, parentId: replacedBy.get(c.parentId)! } : c))
}

// The comment thread a viewer sees for one post: its own comments plus, for
// a cross-post, those of every sibling they can see — oldest first, handler
// copies deduped, and every comment reported under the requested post's id
// (clients key their comment caches by `comment.postId`).
export async function mergedPostComments<I extends Prisma.CommentInclude>(
  postId: string,
  siblingPostIds: string[],
  where: Prisma.CommentWhereInput,
  include: I
) {
  const comments = await prisma.comment.findMany({
    where: { ...where, postId: { in: siblingPostIds } },
    include,
    orderBy: { createdAt: 'asc' },
  })
  if (siblingPostIds.length <= 1) return comments
  return dedupeHandlerCommentCopies(comments, postId).map((c) => ({ ...c, postId }))
}

// Replaces each cross-posted post's `_count.comments` with the size of the
// merged thread the viewer would see (mergedPostComments), so the feed's
// comment count matches the thread it opens. One Comment query for the
// whole page; other posts are returned untouched.
export async function mergeCrossPostCommentCounts<
  T extends { id: string; crossPostId: string | null; _count: { comments: number; likes: number } },
>(posts: T[], siblingIds: Map<string, string[]>): Promise<T[]> {
  const merging = [...siblingIds].filter(([, ids]) => ids.length > 1)
  if (merging.length === 0) return posts

  const comments = await prisma.comment.findMany({
    where: { postId: { in: merging.flatMap(([, ids]) => ids) } },
    select: { id: true, postId: true, parentId: true, metadata: true },
  })

  return posts.map((post) => {
    const ids = post.crossPostId ? siblingIds.get(post.crossPostId) : undefined
    if (!ids || ids.length <= 1) return post
    const thread = dedupeHandlerCommentCopies(
      comments.filter((c) => ids.includes(c.postId)),
      post.id
    )
    return { ...post, _count: { ...post._count, comments: thread.length } }
  })
}
