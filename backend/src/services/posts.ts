import type { ReactionType } from '@prisma/client';
import { prisma } from '../db.js';
import { summarizeReactions } from './reactions.js';
import { attachPeopleToPosts, type PersonTag } from './media/personTags.js';
import { getPostTypeHandler } from './postTypes/registry.js';

// Shared Prisma include shape for fetching a post as a member should see it —
// used by every post-returning endpoint (feed, detail, search, on-this-day,
// create, update, interactions, favorites) so the author/group/counts/likes/
// favorites relations aren't hand-repeated at every call site.
export const postInclude = (userId: string) => ({
  author: { select: { id: true, name: true, avatarUrl: true } },
  // The feed can span several groups (see the groupIds filter on GET /), so
  // clients need the group's name on each post to label where it belongs.
  group: { select: { id: true, name: true } },
  _count: { select: { comments: true, likes: true } },
  // All reaction rows (not just this user's) so the response can show a
  // per-emoji breakdown, not just a total — see services/reactions.ts.
  // Ordered most-recent-first and carrying the reactor's identity so
  // shapePost can expose recentReactors ("who reacted, not just a count").
  likes: {
    select: { type: true, userId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  favorites: { where: { userId }, select: { id: true } },
});

// Shared response shape for a post — used everywhere a post (list, detail,
// create, update, favorites) is returned to a member, so the
// commentCount/likeCount/likedByMe/favoritedByMe/reactions mapping isn't
// repeated at every call site.
//
// crossPostId is deliberately destructured out (and not part of the return
// value) rather than left to `...rest` — the cross-posting privacy rule is
// that a non-author must never be able to tell a post was cross-posted, so
// that id can never leak into any shaped response. The AUTHOR-only
// `sharedWithGroups` field is attached separately, see attachSharedWithGroups
// below.
export function shapePost<
  T extends {
    crossPostId: string | null;
    _count: { comments: number; likes: number };
    likes: { type: ReactionType; userId: string; user: { id: string; name: string; avatarUrl: string | null } }[];
    favorites: { id: string }[];
  }
>(post: T, userId: string) {
  const { _count, likes, favorites, crossPostId: _crossPostId, ...rest } = post;
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

// Removes every sibling-but-one of a cross-post from a page of results,
// keeping the first occurrence — used by GET / and GET /favorites so a
// member of several of a cross-post's target groups sees it once. A plain
// (non-cross-posted) post's null crossPostId is never deduped against
// another null.
export function dedupeByCrossPostId<T extends { crossPostId: string | null }>(posts: T[]): T[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (!post.crossPostId) return true;
    if (seen.has(post.crossPostId)) return false;
    seen.add(post.crossPostId);
    return true;
  });
}

// Cross-page counterpart to dedupeByCrossPostId: a cross-post's sibling rows
// share createdAt, so they can straddle a cursor page boundary — drop
// whichever leading rows of THIS page are still the same crossPostId as the
// row the cursor points at, since those were already shown on the previous
// page.
export function dropLeadingCrossPostSiblings<T extends { crossPostId: string | null }>(
  posts: T[],
  crossPostId: string
): T[] {
  let i = 0;
  while (i < posts.length && posts[i].crossPostId === crossPostId) i++;
  return posts.slice(i);
}

// AUTHOR-only: for a cross-posted post the viewer themselves authored,
// attaches `sharedWithGroups` — every target group the write fanned out to
// (including the post's own group). Batches one findMany over every distinct
// crossPostId on the page rather than a per-post query. A non-author (or a
// non-cross-posted post) gets no `sharedWithGroups` key at all — see the
// privacy rule on shapePost above.
export async function attachSharedWithGroups<
  S extends { id: string },
  T extends { id: string; authorId: string; crossPostId: string | null }
>(shapedPosts: S[], rawPosts: T[], viewerId: string): Promise<(S & { sharedWithGroups?: { id: string; name: string }[] })[]> {
  const rawById = new Map(rawPosts.map((p) => [p.id, p]));
  const crossPostIds = [
    ...new Set(
      rawPosts.filter((p) => p.crossPostId && p.authorId === viewerId).map((p) => p.crossPostId as string)
    ),
  ];

  if (crossPostIds.length === 0) return shapedPosts;

  const siblings = await prisma.post.findMany({
    where: { crossPostId: { in: crossPostIds } },
    select: { crossPostId: true, group: { select: { id: true, name: true } } },
  });
  const groupsByCrossPostId = new Map<string, { id: string; name: string }[]>();
  for (const s of siblings) {
    const list = groupsByCrossPostId.get(s.crossPostId!) ?? [];
    list.push(s.group);
    groupsByCrossPostId.set(s.crossPostId!, list);
  }

  return shapedPosts.map((post) => {
    const raw = rawById.get(post.id);
    if (raw?.crossPostId && raw.authorId === viewerId) {
      return { ...post, sharedWithGroups: groupsByCrossPostId.get(raw.crossPostId) ?? [] };
    }
    return post;
  });
}

// Batches each post type's own enrichment (e.g. poll vote aggregation) across
// a whole page — groups by `type` and calls that type's enrichPosts() once
// per group (one query per type per page, not per post; see the
// PostTypeHandler.enrichPosts contract in services/postTypes/types.ts).
// Mutates the given posts in place, same as the handler contract.
//
// Fail-soft only applies to provider-ish enrichment (people/Immich, see
// attachPeopleToPosts) — a plain DB error out of a handler's own query here
// is allowed to propagate to the global error handler like any other route
// failure, since (unlike an external media provider) PostInteraction is this
// service's own database, not routine external flakiness.
async function enrichPostTypes(shapedPosts: Array<Record<string, any> & { id: string; type: string }>, viewerId: string): Promise<void> {
  const postsByType = new Map<string, Array<Record<string, any> & { id: string; type: string }>>();
  for (const post of shapedPosts) {
    const list = postsByType.get(post.type);
    if (list) list.push(post);
    else postsByType.set(post.type, [post]);
  }

  for (const [type, posts] of postsByType) {
    const handler = getPostTypeHandler(type);
    if (!handler?.enrichPosts) continue;
    await handler.enrichPosts(posts, viewerId);
  }
}

// The one seam every member-facing post-returning endpoint (feed, single
// post, search, on-this-day, favorites) routes through to get a uniform
// `people` field (and, for posts of a custom type like POLL, that type's own
// enriched view — see enrichPostTypes above) — batches the person-tag lookup
// (and its Immich round trips) across the whole page instead of once per
// post. Not used by POST/PATCH's own response: creating/editing a post
// returns `people: []` untouched (and no type-specific enrichment either)
// rather than waiting on a media provider (see routes/posts.ts) — a brand
// new post has no votes/interactions yet anyway.
export async function shapePostsWithPeople<
  T extends Parameters<typeof shapePost>[0] & { id: string; authorId: string; uploadedAssetUrls: string[]; type: string }
>(posts: T[], userId: string): Promise<(ReturnType<typeof shapePost> & { people: PersonTag[]; sharedWithGroups?: { id: string; name: string }[] })[]> {
  const shaped = posts.map((post) => shapePost(post, userId));
  const peopleByPostId = await attachPeopleToPosts(shaped);
  const withPeople = shaped.map((post) => ({ ...post, people: peopleByPostId.get(post.id) ?? [] }));
  await enrichPostTypes(withPeople, userId);
  return attachSharedWithGroups(withPeople, posts, userId);
}
