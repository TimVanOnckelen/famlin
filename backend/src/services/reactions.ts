import { prisma } from '../db.js';
import type { ReactionType } from '@prisma/client';

// Used right after a single like/reaction mutation, where only one
// post/comment's counts are needed and a fresh query is cheap and simplest.
export async function reactionCounts(target: { postId: string } | { commentId: string }): Promise<Record<string, number>> {
  const groups = await prisma.like.groupBy({
    by: ['type'],
    where: target,
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const g of groups) counts[g.type] = g._count;
  return counts;
}

// Reduces an already-fetched `likes` array (see postInclude/commentInclude)
// into per-type counts + the current user's own reaction, without an extra
// query — used by list endpoints where every reaction row was already loaded.
export function summarizeReactions(likes: { type: ReactionType; userId: string }[], userId: string) {
  const counts: Record<string, number> = {};
  let myReaction: string | null = null;
  for (const like of likes) {
    counts[like.type] = (counts[like.type] ?? 0) + 1;
    if (like.userId === userId) myReaction = like.type;
  }
  return { counts, myReaction };
}
