import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Post, ReactionType } from '@/types';
import { reactToPost, toggleFavoritePost } from '@famlin/api-client';
import { patchPostInCaches } from '@/utils/postCache';

// Shared by PostCard, ImageViewerScreen's PhotoActionsBar, and
// PostDetailScreen: an optimistic reaction toggle that patches every cache
// entry holding this post (feed pages, the single-post cache, favorites)
// before the request resolves, then reconciles via invalidation once it
// settles. `post` must be the currently-loaded post the caller is reacting
// to — callers whose post is still loading (e.g. the image viewer, which
// fetches it lazily) only ever invoke `mutate()` from UI that's itself
// gated on the post being loaded, so a non-null assertion at the call site
// is safe there.
export function useReactToPost(post: Post) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (type: ReactionType) => reactToPost(post.id, type),
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', post.id] });

      const nextReaction = post.myReaction === type ? null : type;
      const patch = (p: Post) => {
        const reactions = { ...p.reactions };
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1);
        if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1;
        return {
          ...p,
          myReaction: nextReaction,
          reactions,
          likeCount: Object.values(reactions).reduce((sum, n) => sum + (n || 0), 0),
          likedByMe: nextReaction !== null,
        };
      };

      patchPostInCaches(queryClient, post.id, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
    },
  });
}

// Shared by the same three call sites as useReactToPost — see its comment.
export function useToggleFavorite(post: Post) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => toggleFavoritePost(post.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', post.id] });

      const nextFavorited = !post.favoritedByMe;
      const patch = (p: Post) => ({ ...p, favoritedByMe: nextFavorited });

      patchPostInCaches(queryClient, post.id, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}
