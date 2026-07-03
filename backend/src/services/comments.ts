import type { ReactionType } from '@prisma/client';
import { summarizeReactions } from './reactions.js';

// Shared response shape for a comment — mirrors services/posts.ts shapePost.
export function shapeComment<
  T extends {
    _count: { likes: number };
    likes: { type: ReactionType; userId: string }[];
  }
>(comment: T, userId: string) {
  const { _count, likes, ...rest } = comment;
  const { counts, myReaction } = summarizeReactions(likes, userId);
  return {
    ...rest,
    likeCount: _count.likes,
    likedByMe: myReaction !== null,
    myReaction,
    reactions: counts,
  };
}
