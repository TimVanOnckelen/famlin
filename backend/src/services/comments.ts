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

// --- Paginated thread (issue #130) -------------------------------------------
// GET /api/posts/:postId/comments?take=&cursor= pages a thread newest-first,
// by *top-level* comment: each page holds the `take` newest top-level comments
// that are older than the cursor, plus every reply (at any depth) under them,
// so a thread never splits across pages. Clients reverse for display and put
// a "load older" control at the top (chat's precedent).
//
// Paging happens in memory over a lightweight id-only scan of the merged
// thread rather than with a Prisma row cursor, because a cross-post's thread
// is merged and deduped across sibling posts (mergedPostComments) — a page of
// raw rows wouldn't be a page of the thread the viewer sees. Only the page's
// own rows are then loaded with the caller's (heavier) include.
//
// The cursor is an opaque base64url `(createdAt, id)` keyset of the last
// top-level comment of the previous page, so deleting that comment doesn't
// strand the next page. An unparseable cursor restarts from the newest page
// (same rule as the photo timeline).

function encodeCommentCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url')
}

function decodeCommentCursor(cursor: string): { createdAt: string; id: string } | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const sep = decoded.lastIndexOf('|')
  if (sep === -1) return null
  const createdAt = decoded.slice(0, sep)
  if (Number.isNaN(Date.parse(createdAt))) return null
  return { createdAt: new Date(createdAt).toISOString(), id: decoded.slice(sep + 1) }
}

// Newest first, id as the tiebreaker — the order a page's items come back in.
function newestFirst(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  const diff = b.createdAt.getTime() - a.createdAt.getTime()
  if (diff !== 0) return diff
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

export async function paginatedPostComments<I extends Prisma.CommentInclude>(
  postId: string,
  siblingPostIds: string[],
  where: Prisma.CommentWhereInput,
  include: I,
  page: { cursor?: string; take: number }
) {
  const scanned = await prisma.comment.findMany({
    where: { ...where, postId: { in: siblingPostIds } },
    select: { id: true, postId: true, parentId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const thread = siblingPostIds.length > 1 ? dedupeHandlerCommentCopies(scanned, postId) : scanned

  // Each comment's top-level ancestor. A parent outside the scanned set (it
  // can't be filtered out by assetUrl, since replies inherit it, but be safe)
  // makes the comment its own thread root.
  const byId = new Map(thread.map((c) => [c.id, c]))
  const rootCache = new Map<string, string>()
  const rootOf = (id: string): string => {
    const cached = rootCache.get(id)
    if (cached) return cached
    const seen = new Set<string>()
    let current = byId.get(id)!
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.id)
      current = byId.get(current.parentId)!
    }
    rootCache.set(id, current.id)
    return current.id
  }

  const roots = thread.filter((c) => rootOf(c.id) === c.id).sort(newestFirst)

  let start = 0
  const decoded = page.cursor ? decodeCommentCursor(page.cursor) : null
  if (decoded) {
    start = roots.findIndex((r) => {
      const at = r.createdAt.toISOString()
      return at < decoded.createdAt || (at === decoded.createdAt && r.id < decoded.id)
    })
    if (start === -1) start = roots.length
  }
  const pageRoots = roots.slice(start, start + page.take)
  const hasMore = start + page.take < roots.length
  const last = pageRoots[pageRoots.length - 1]
  const nextCursor = hasMore && last ? encodeCommentCursor(last.createdAt, last.id) : null

  const pageRootIds = new Set(pageRoots.map((r) => r.id))
  const pageIds = thread.filter((c) => pageRootIds.has(rootOf(c.id))).map((c) => c.id)
  if (pageIds.length === 0) return { items: [], nextCursor }

  const rows = await prisma.comment.findMany({ where: { id: { in: pageIds } }, include })
  // Carry over the dedupe's re-parenting (a reply to a dropped sibling copy
  // now hangs off the kept one) and report every comment under this postId.
  const merged = siblingPostIds.length > 1
  const items = rows
    .map((row) => (merged ? { ...row, postId, parentId: byId.get(row.id)?.parentId ?? row.parentId } : row))
    .sort(newestFirst)
  return { items, nextCursor }
}
