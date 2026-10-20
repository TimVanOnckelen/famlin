import { useMutation, useQueryClient, QueryClient } from '@tanstack/react-query'
import {
  Post,
  ReactionType,
  reactToPost,
  toggleFavoritePost,
  patchPostInCaches,
  updatePost,
  deletePost,
  uploadFiles,
} from '@famlin/api-client'

// One optimistic-update recipe for a post's reaction, shared by PostCard's
// own reaction button/picker (useReactToPost below) and the feed's `l`
// keyboard shortcut (useQuickPostActions) — both need the exact same
// "tapping the same reaction again removes it" cache patch.
function applyReactionPatch(queryClient: QueryClient, post: Post, type: ReactionType) {
  const nextReaction = post.myReaction === type ? null : type
  patchPostInCaches(queryClient, post.id, (p) => {
    const reactions = { ...p.reactions }
    if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1)
    if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1
    return {
      ...p,
      myReaction: nextReaction,
      reactions,
      likeCount: Object.values(reactions).reduce((sum, n) => sum + (n || 0), 0),
      likedByMe: nextReaction !== null,
    }
  })
}

// Mirrors mobile's usePostMutations.ts naming (useReactToPost/useToggleFavorite
// in mobile/src/hooks/usePostMutations.ts) — same two post-level actions, web's
// own optimistic-cache-patch implementation.
export function useReactToPost(post: Post) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (type: ReactionType) => reactToPost(post.id, type),
    onMutate: async (type: ReactionType) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] })
      applyReactionPatch(queryClient, post, type)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

export function useToggleFavorite(post: Post) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => toggleFavoritePost(post.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['posts'] })
      const nextFavorited = !post.favoritedByMe
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, favoritedByMe: nextFavorited }))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })
}

// The feed's `l`/`f` keyboard shortcuts act on whichever post is currently
// focused, which changes from one keypress to the next — useReactToPost/
// useToggleFavorite above need a stable `post` to build a mutation around at
// mount time, so they don't fit a "whichever card is focused right now"
// caller. This calls the same API + cache patch directly instead.
export function useQuickPostActions() {
  const queryClient = useQueryClient()

  function likeToggle(post: Post) {
    const type: ReactionType = post.myReaction ?? 'LOVE'
    applyReactionPatch(queryClient, post, type)
    reactToPost(post.id, type).finally(() => queryClient.invalidateQueries({ queryKey: ['posts'] }))
  }

  function favoriteToggle(post: Post) {
    const nextFavorited = !post.favoritedByMe
    patchPostInCaches(queryClient, post.id, (p) => ({ ...p, favoritedByMe: nextFavorited }))
    toggleFavoritePost(post.id).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    })
  }

  return { likeToggle, favoriteToggle }
}

export interface EditPostInput {
  content: string
  // The photos kept from the post, in order — the edit's complete list
  // before `files` are appended (the server replaces the stored list).
  uploadedAssetUrls: string[]
  files?: File[]
}

// Editing a post (author, or an admin moderating — the server decides). The
// response carries `people: []` (the server doesn't make an edit wait on the
// media provider), so only the edited fields are merged into the cached post
// rather than replacing it wholesale, then the lists refetch for the rest.
// `files` are uploaded first and appended to `uploadedAssetUrls` — inside the
// mutation, so isPending covers the upload too.
export function useEditPost(post: Post) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ content, uploadedAssetUrls, files = [] }: EditPostInput) => {
      const uploaded = files.length > 0 ? await uploadFiles(files) : []
      return updatePost(post.id, { content, uploadedAssetUrls: [...uploadedAssetUrls, ...uploaded] })
    },
    onSuccess: (updated) => {
      patchPostInCaches(queryClient, post.id, (p) => ({
        ...p,
        content: updated.content,
        uploadedAssetUrls: updated.uploadedAssetUrls,
        editedAt: updated.editedAt,
      }))
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
      queryClient.invalidateQueries({ queryKey: ['post', post.id] })
    },
  })
}

// Deleting is permanent (hard delete, no restore), so callers confirm first.
// The post is dropped from every cached list straight away so the feed
// underneath the detail modal doesn't flash it back in before refetching;
// its own ['post', id] entry is left for the caller to navigate away from
// (refetching it now would just 404 under the still-open view).
export function useDeletePost(post: Post) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => {
      type Pages = { pages: { items: Post[] }[] }
      const dropPost = (old: Pages | undefined) =>
        old?.pages
          ? { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.filter((p) => p.id !== post.id) })) }
          : old
      queryClient.setQueriesData<Pages>({ queryKey: ['posts'] }, dropPost)
      queryClient.setQueriesData<Pages>({ queryKey: ['favorites'] }, dropPost)
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })
}
