import { QueryClient } from '@tanstack/react-query'
import { api } from './client'
import { Comment, ReactionType } from './types'
import { ReactionResult } from './posts'

export async function fetchComments(postId: string, assetUrl?: string): Promise<Comment[]> {
  const response = await api.get<Comment[]>(`/posts/${postId}/comments`, {
    params: assetUrl ? { assetUrl } : undefined,
  })
  return response.data
}

// --- Paginated thread (issue #130, server feature `paginatedComments`) ------
// `GET /posts/:postId/comments?take=&cursor=` pages a thread newest-first by
// top-level comment: each page holds the `take` newest top-level comments
// older than the cursor plus every reply under them, so a thread never splits
// across pages. Servers without the feature ignore the params and return the
// whole thread as a bare array — fetchCommentsPage turns that into a single,
// final page, so callers need no fallback of their own.

export interface CommentsPage {
  items: Comment[]
  nextCursor: string | null
}

export const COMMENTS_PAGE_SIZE = 30

// The useInfiniteQuery key for a post's paged thread. Deliberately a child of
// ['comments', postId], so every existing invalidation of that prefix (after
// a check-in, an album upload, a delete) refetches the paged thread too.
export const pagedCommentsQueryKey = (postId: string) => ['comments', postId, 'paged'] as const

export async function fetchCommentsPage(
  postId: string,
  options: { cursor?: string | null; take?: number; assetUrl?: string } = {}
): Promise<CommentsPage> {
  const response = await api.get<CommentsPage | Comment[]>(`/posts/${postId}/comments`, {
    params: {
      take: options.take ?? COMMENTS_PAGE_SIZE,
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.assetUrl ? { assetUrl: options.assetUrl } : {}),
    },
  })
  const data = response.data
  return Array.isArray(data) ? { items: data, nextCursor: null } : data
}

// A paged thread in display order: oldest first, each comment once (a page
// refetched after new comments arrived can overlap the one before it).
export function flattenCommentPages(pages: readonly CommentsPage[]): Comment[] {
  const byId = new Map<string, Comment>()
  for (const page of pages) for (const comment of page.items) byId.set(comment.id, comment)
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1
  )
}

type InfiniteComments = { pages: CommentsPage[]; pageParams: unknown[] }

// Applies `patch` to one comment in both caches a post's thread can live in:
// the flat ['comments', postId] list (fetchComments — trip and album pages)
// and the paged thread (pagedCommentsQueryKey).
export function patchCommentInCaches(
  queryClient: QueryClient,
  postId: string,
  commentId: string,
  patch: (comment: Comment) => Comment
) {
  const apply = (comment: Comment) => (comment.id === commentId ? patch(comment) : comment)
  queryClient.setQueryData<Comment[]>(['comments', postId], (old) => old?.map(apply))
  queryClient.setQueryData<InfiniteComments>(pagedCommentsQueryKey(postId), (old) =>
    old ? { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.map(apply) })) } : old
  )
}

// Adds a just-created comment to both caches — on the paged thread, to the
// newest page, which is where the server would put it on a refetch.
export function addCommentToCaches(queryClient: QueryClient, postId: string, comment: Comment) {
  queryClient.setQueryData<Comment[]>(['comments', postId], (old) => (old ? [...old, comment] : old))
  queryClient.setQueryData<InfiniteComments>(pagedCommentsQueryKey(postId), (old) =>
    old && old.pages.length > 0
      ? {
          ...old,
          pages: [{ ...old.pages[0], items: [comment, ...old.pages[0].items] }, ...old.pages.slice(1)],
        }
      : old
  )
}

export interface CreateCommentBody {
  // Optional so a comment can be photo/video-only — the server rejects a
  // request with neither content nor attachments.
  content?: string
  parentId?: string
  mentionedUserIds?: string[]
  assetUrl?: string
  // Photos/videos the commenter uploaded as part of this comment itself
  // (from POST /api/uploads) — distinct from assetUrl above. attachmentUrl is
  // the legacy single-attachment field; send attachmentUrls (max
  // resolveServerLimits().maxAttachments), which wins when the server understands it.
  attachmentUrl?: string
  attachmentUrls?: string[]
}

export async function createComment(postId: string, data: CreateCommentBody): Promise<Comment> {
  const response = await api.post<Comment>(`/posts/${postId}/comments`, data)
  return response.data
}

export interface UpdateCommentBody {
  content?: string
  // The comment's complete attachment list after the edit — send it to add or
  // remove photos (it replaces the stored list wholesale), omit it to leave
  // them untouched. The two fields are independent, but the server rejects an
  // edit that would leave the comment with neither text nor photos.
  // A handler-authored comment (a TRIP check-in, an ALBUM contribution) keeps
  // its photos elsewhere and rejects attachment edits — text only there.
  attachmentUrl?: string
  attachmentUrls?: string[]
}

export async function updateComment(commentId: string, data: UpdateCommentBody): Promise<Comment> {
  const response = await api.patch<Comment>(`/comments/${commentId}`, data)
  return response.data
}

export async function deleteComment(commentId: string): Promise<void> {
  await api.delete(`/comments/${commentId}`)
}

export async function reactToComment(commentId: string, type: ReactionType): Promise<ReactionResult> {
  const response = await api.post<ReactionResult>(`/comments/${commentId}/like`, { type })
  return response.data
}
