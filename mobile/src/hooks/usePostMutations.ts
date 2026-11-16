import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Post, ReactionType } from '@/types'
import { reactToPost, toggleFavoritePost } from '@famlin/api-client'
import { patchPostInCaches } from '@/utils/postCache'
import { useAuthStore } from '@/stores/authStore'

// Shared by PostCard, ImageViewerScreen's PhotoActionsBar, and
// PostDetailScreen: an optimistic reaction/favorite toggle that patches every
// cache entry holding this post (feed pages, the single-post cache, favorites)
// before the request resolves, then reconciles from the server's response via
// the same patch helper. Deliberately no ['posts'] invalidation on success:
// that refetches every page of every mounted feed and re-renders cells whose
// server-computed fields drifted (poll tallies, trip day numbers, page
// boundaries shifted by a new post) — a whole-feed hitch landing mid-scroll
// after every single like. Invalidation is kept only for the error path (the
// simplest correct rollback of the optimistic patch) and for queries whose
// membership actually changes (['favorites']). `post` must be the
// currently-loaded post the caller is reacting to — callers whose post is
// still loading (e.g. the image viewer, which fetches it lazily) only ever
// invoke `mutate()` from UI that's itself gated on the post being loaded, so a
// non-null assertion at the call site is safe there.

function totalReactions(counts: Partial<Record<ReactionType, number>>): number {
  return Object.values(counts).reduce((sum, n) => sum + (n || 0), 0)
}

// Keeps the top-3 reactor stack in sync without a refetch: reacting puts me
// at the front (newest first, the order shapePost returns server-side),
// un-reacting removes me. Read without subscribing — the patch runs at
// mutation time, and a profile update doesn't need to re-render every card.
function withMyReaction(reactors: Post['recentReactors'], reacting: boolean): Post['recentReactors'] {
  const me = useAuthStore.getState().user
  if (!me) return reactors
  const others = (reactors ?? []).filter((r) => r.id !== me.id)
  if (!reacting) return others
  return [{ id: me.id, name: me.name, avatarUrl: me.avatarUrl }, ...others].slice(0, 3)
}

export function useReactToPost(post: Post) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (type: ReactionType) => reactToPost(post.id, type),
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] })
      await queryClient.cancelQueries({ queryKey: ['post', post.id] })

      const nextReaction = post.myReaction === type ? null : type
      const patch = (p: Post) => {
        const reactions = { ...p.reactions }
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1)
        if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1
        return {
          ...p,
          myReaction: nextReaction,
          reactions,
          likeCount: totalReactions(reactions),
          likedByMe: nextReaction !== null,
          recentReactors: withMyReaction(p.recentReactors, nextReaction !== null),
        }
      }

      patchPostInCaches(queryClient, post.id, patch)
    },
    onSuccess: (result) => {
      // The server's counts are authoritative — on a cross-posted post they
      // are merged across every sibling, which the optimistic local math
      // can't know. Patching them in keeps all caches consistent with zero
      // extra requests.
      patchPostInCaches(queryClient, post.id, (p) => ({
        ...p,
        myReaction: result.myReaction,
        reactions: result.counts,
        likeCount: totalReactions(result.counts),
        likedByMe: result.myReaction !== null,
        recentReactors: withMyReaction(p.recentReactors, result.myReaction !== null),
      }))
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['post', post.id] })
    },
  })
}

// Shared by the same three call sites as useReactToPost — see its comment.
export function useToggleFavorite(post: Post) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => toggleFavoritePost(post.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['posts'] })
      await queryClient.cancelQueries({ queryKey: ['post', post.id] })

      const nextFavorited = !post.favoritedByMe
      const patch = (p: Post) => ({ ...p, favoritedByMe: nextFavorited })

      patchPostInCaches(queryClient, post.id, patch)
    },
    onSuccess: (result) => {
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, favoritedByMe: result.favorited }))
      // The favorites list's membership itself changed (a post entered or
      // left it), which patching items can't express — refetch that one
      // query. It's only active while the Favorites screen is mounted; the
      // feed caches are already patched above.
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['post', post.id] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })
}
