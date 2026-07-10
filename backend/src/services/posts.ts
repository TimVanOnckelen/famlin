import type { ReactionType } from '@prisma/client';
import { summarizeReactions } from './reactions.js';
import { attachPeopleToPosts, type PersonTag } from './media/personTags.js';

// Shared response shape for a post — used everywhere a post (list, detail,
// create, update, favorites) is returned to a member, so the
// commentCount/likeCount/likedByMe/favoritedByMe/reactions mapping isn't
// repeated at every call site.
export function shapePost<
  T extends {
    _count: { comments: number; likes: number };
    likes: { type: ReactionType; userId: string; user: { id: string; name: string; avatarUrl: string | null } }[];
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
    // Who reacted, not just a count — the include orders likes newest-first,
    // so this is the three most recent reactors.
    recentReactors: likes.slice(0, 3).map((like) => like.user),
    favoritedByMe: favorites.length > 0,
  };
}

// The one seam every member-facing post-returning endpoint (feed, single
// post, search, on-this-day, favorites) routes through to get a uniform
// `people` field — batches the person-tag lookup (and its Immich round
// trips) across the whole page instead of once per post. Not used by
// POST/PATCH's own response: creating/editing a post returns `people: []`
// untouched rather than waiting on a media provider (see routes/posts.ts).
export async function shapePostsWithPeople<
  T extends Parameters<typeof shapePost>[0] & { id: string; uploadedAssetUrls: string[] }
>(posts: T[], userId: string): Promise<(ReturnType<typeof shapePost> & { people: PersonTag[] })[]> {
  const shaped = posts.map((post) => shapePost(post, userId));
  const peopleByPostId = await attachPeopleToPosts(shaped);
  return shaped.map((post) => ({ ...post, people: peopleByPostId.get(post.id) ?? [] }));
}
