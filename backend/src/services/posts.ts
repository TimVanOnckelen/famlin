import type { ReactionType } from '@prisma/client';
import { summarizeReactions } from './reactions.js';

// Shared response shape for a post — used everywhere a post (list, detail,
// create, update, favorites) is returned to a member, so the
// commentCount/likeCount/likedByMe/favoritedByMe/reactions mapping isn't
// repeated at every call site.
export function shapePost<
  T extends {
    _count: { comments: number; likes: number };
    likes: { type: ReactionType; userId: string }[];
    favorites: { id: string }[];
  }
>(post: T, userId: string) {
  const { _count, likes, favorites, ...rest } = post;
  const { counts, myReaction } = summarizeReactions(likes, userId);
  return {
    ...rest,
    commentCount: _count.comments,
    likeCount: _count.likes,
    likedByMe: myReaction !== null,
    myReaction,
    reactions: counts,
    favoritedByMe: favorites.length > 0,
  };
}
