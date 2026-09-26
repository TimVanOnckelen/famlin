import { Prisma, ReactionType } from '@prisma/client';
import { prisma } from '../db.js';
import { getUserCircleIds, visibleStoriesWhere } from './circles.js';
import { deleteUploadFiles } from './uploads.js';

// Stories: one photo shared for 24 hours, optionally pinned by its author
// into the group's permanent Highlights. See the Story model in
// schema.prisma for why this is its own table rather than a Post type.

export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

// A story is readable while it's live, or forever once pinned. An expired,
// unpinned story is gone as far as every member-facing surface is concerned
// even in the (up to ~10 minute) window before src/jobs/expireStories.ts
// physically deletes it.
export function liveOrPinnedWhere(now = new Date()): Prisma.StoryWhereInput {
  return { OR: [{ expiresAt: { gt: now } }, { pinnedAt: { not: null } }] };
}

export function isLive(story: { expiresAt: Date }, now = new Date()): boolean {
  return story.expiresAt > now;
}

// Every Story row one create call produced (one per target group for a
// cross-post) — author pin/unpin/delete fan out across all of them.
export function siblingsWhere(story: { id: string; crossStoryId: string | null }): Prisma.StoryWhereInput {
  return story.crossStoryId ? { crossStoryId: story.crossStoryId } : { id: story.id };
}

export const storyInclude = {
  author: { select: { id: true, name: true, avatarUrl: true } },
  group: { select: { id: true, name: true } },
  circle: { select: { id: true, name: true } },
} satisfies Prisma.StoryInclude;

export type StoryWithRelations = Prisma.StoryGetPayload<{ include: typeof storyInclude }>;

// Loads one story the caller is allowed to see — a group member (and circle
// member, for a circle story) in a group that still has stories enabled,
// and the story still live or pinned. Anything else is null, which routes
// turn into a 404 (never a 403) so a story's existence can't be probed.
export async function findVisibleStory(id: string, userId: string): Promise<StoryWithRelations | null> {
  const [memberships, circleIds] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    getUserCircleIds(userId),
  ]);
  return prisma.story.findFirst({
    where: {
      AND: [
        { id },
        visibleStoriesWhere(
          memberships.map((m) => m.groupId),
          circleIds
        ),
        liveOrPinnedWhere(),
      ],
    },
    include: storyInclude,
  });
}

function siblingKey(story: { id: string; crossStoryId: string | null }): string {
  return story.crossStoryId ?? story.id;
}

// Drops later rows that are cross-post siblings of an earlier one, so a
// member of several target groups sees the story once (same rule as the
// feed's cross-post dedupe in routes/posts.ts).
export function dedupeSiblings<T extends { id: string; crossStoryId: string | null }>(stories: T[]): T[] {
  const seen = new Set<string>();
  return stories.filter((story) => {
    const key = siblingKey(story);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ShapedStory {
  id: string;
  groupId: string;
  group: { id: string; name: string };
  circleId: string | null;
  circle: { id: string; name: string } | null;
  author: { id: string; name: string; avatarUrl: string | null };
  imageUrl: string;
  createdAt: Date;
  expiresAt: Date;
  pinnedAt: Date | null;
  expired: boolean;
  isMine: boolean;
  seen: boolean;
  myReaction: ReactionType | null;
  myReply: { content: string; createdAt: Date } | null;
  // Author-only: aggregated across cross-post siblings, one entry per
  // person. null for everyone else — viewers never learn who else looked.
  stats: { viewCount: number; reactionCount: number; replyCount: number } | null;
  // Author-only, like Post.sharedWithGroups: non-authors can't tell a story
  // was cross-posted.
  sharedWithGroups?: Array<{ id: string; name: string }>;
}

// Attaches per-viewer state (seen / my reaction / my reply) and, on the
// viewer's own stories, the author stats. Views, reactions and replies are
// recorded on whichever sibling row the viewer happened to open, so every
// lookup here spans the whole sibling set.
export async function shapeStories(stories: StoryWithRelations[], viewerId: string): Promise<ShapedStory[]> {
  if (stories.length === 0) return [];
  const now = new Date();

  const crossIds = [...new Set(stories.map((s) => s.crossStoryId).filter((id): id is string => !!id))];
  const siblingRows = crossIds.length
    ? await prisma.story.findMany({
        where: { crossStoryId: { in: crossIds } },
        select: { id: true, crossStoryId: true, group: { select: { id: true, name: true } } },
      })
    : [];
  const idsByKey = new Map<string, string[]>();
  const groupsByKey = new Map<string, Array<{ id: string; name: string }>>();
  for (const story of stories) {
    idsByKey.set(siblingKey(story), [story.id]);
    groupsByKey.set(siblingKey(story), [story.group]);
  }
  for (const row of siblingRows) {
    const key = row.crossStoryId!;
    const ids = idsByKey.get(key) ?? [];
    if (!ids.includes(row.id)) ids.push(row.id);
    idsByKey.set(key, ids);
    const groups = groupsByKey.get(key) ?? [];
    if (!groups.some((g) => g.id === row.group.id)) groups.push(row.group);
    groupsByKey.set(key, groups);
  }
  const keyByStoryId = new Map<string, string>();
  for (const [key, ids] of idsByKey) ids.forEach((id) => keyByStoryId.set(id, key));
  const allIds = [...keyByStoryId.keys()];

  const ownKeys = new Set(stories.filter((s) => s.authorId === viewerId).map(siblingKey));
  const ownIds = allIds.filter((id) => ownKeys.has(keyByStoryId.get(id)!));

  const [myViews, myReactions, myReplies, ownViews, ownReactions, ownReplies] = await Promise.all([
    prisma.storyView.findMany({ where: { storyId: { in: allIds }, userId: viewerId }, select: { storyId: true } }),
    prisma.storyReaction.findMany({
      where: { storyId: { in: allIds }, userId: viewerId },
      select: { storyId: true, type: true },
    }),
    prisma.storyReply.findMany({
      where: { storyId: { in: allIds }, fromUserId: viewerId },
      select: { storyId: true, content: true, createdAt: true },
    }),
    ownIds.length
      ? prisma.storyView.findMany({ where: { storyId: { in: ownIds } }, select: { storyId: true, userId: true } })
      : [],
    ownIds.length
      ? prisma.storyReaction.findMany({ where: { storyId: { in: ownIds } }, select: { storyId: true, userId: true } })
      : [],
    ownIds.length
      ? prisma.storyReply.findMany({ where: { storyId: { in: ownIds } }, select: { storyId: true, fromUserId: true } })
      : [],
  ]);

  const seenKeys = new Set(myViews.map((v) => keyByStoryId.get(v.storyId)!));
  const reactionByKey = new Map(myReactions.map((r) => [keyByStoryId.get(r.storyId)!, r.type]));
  const replyByKey = new Map(
    myReplies.map((r) => [keyByStoryId.get(r.storyId)!, { content: r.content, createdAt: r.createdAt }])
  );

  function distinctUsersPerKey(rows: Array<{ storyId: string; userId: string }>): Map<string, number> {
    const sets = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = keyByStoryId.get(row.storyId)!;
      const set = sets.get(key) ?? new Set<string>();
      set.add(row.userId);
      sets.set(key, set);
    }
    return new Map([...sets].map(([key, set]) => [key, set.size]));
  }
  const viewCounts = distinctUsersPerKey(ownViews);
  const reactionCounts = distinctUsersPerKey(ownReactions);
  const replyCounts = distinctUsersPerKey(ownReplies.map((r) => ({ storyId: r.storyId, userId: r.fromUserId })));

  return stories.map((story) => {
    const key = siblingKey(story);
    const isMine = story.authorId === viewerId;
    return {
      id: story.id,
      groupId: story.groupId,
      group: story.group,
      circleId: story.circleId,
      circle: story.circle,
      author: story.author,
      imageUrl: story.imageUrl,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      pinnedAt: story.pinnedAt,
      expired: !isLive(story, now),
      isMine,
      // Your own story always counts as seen, so the tray never shows you an
      // "unseen" ring around yourself.
      seen: isMine || seenKeys.has(key),
      myReaction: reactionByKey.get(key) ?? null,
      myReply: replyByKey.get(key) ?? null,
      stats: isMine
        ? {
            viewCount: viewCounts.get(key) ?? 0,
            reactionCount: reactionCounts.get(key) ?? 0,
            replyCount: replyCounts.get(key) ?? 0,
          }
        : null,
      ...(isMine ? { sharedWithGroups: groupsByKey.get(key) ?? [story.group] } : {}),
    };
  });
}

// Every Story row id in the sibling set of `story` — the author-only lists
// (views, reactions, replies) aggregate across all of them.
export async function siblingIds(story: { id: string; crossStoryId: string | null }): Promise<string[]> {
  if (!story.crossStoryId) return [story.id];
  const rows = await prisma.story.findMany({ where: { crossStoryId: story.crossStoryId }, select: { id: true } });
  return rows.map((r) => r.id);
}

// Hard-deletes the matching stories (views, reactions and replies cascade)
// and then every photo no remaining Story row still references. A
// cross-post's siblings share one imageUrl, so admin moderation removing a
// single sibling must leave the file for the others. Returns the number of
// Story rows deleted.
export async function deleteStoriesWithMedia(where: Prisma.StoryWhereInput): Promise<number> {
  const doomed = await prisma.story.findMany({ where, select: { id: true, imageUrl: true } });
  if (doomed.length === 0) return 0;

  await prisma.story.deleteMany({ where: { id: { in: doomed.map((s) => s.id) } } });

  const imageUrls = [...new Set(doomed.map((s) => s.imageUrl))];
  const stillReferenced = await prisma.story.findMany({
    where: { imageUrl: { in: imageUrls } },
    select: { imageUrl: true },
  });
  const keep = new Set(stillReferenced.map((s) => s.imageUrl));
  for (const url of imageUrls) {
    if (keep.has(url)) continue;
    await deleteUploadFiles(url).catch((err) => console.error(`Failed to delete story media ${url}`, err));
  }
  return doomed.length;
}
