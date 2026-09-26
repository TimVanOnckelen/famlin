import { api } from './client';
import type { ReactionType } from './types';

// Stories: one photo shared for 24 hours, optionally pinned by its author
// into the group's permanent Highlights. See backend/src/routes/stories.ts.

export interface StoryAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface Story {
  id: string;
  groupId: string;
  group: { id: string; name: string };
  circleId: string | null;
  circle: { id: string; name: string } | null;
  author: StoryAuthor;
  imageUrl: string;
  createdAt: string;
  expiresAt: string;
  pinnedAt: string | null;
  // True once the 24h are up — only ever seen on a pinned story (Highlight).
  expired: boolean;
  isMine: boolean;
  seen: boolean;
  myReaction: ReactionType | null;
  myReply: { content: string; createdAt: string } | null;
  // Only on your own stories; null for everyone else's.
  stats: { viewCount: number; reactionCount: number; replyCount: number } | null;
  // Only on your own stories: every group a cross-posted story went to.
  sharedWithGroups?: { id: string; name: string }[];
}

export interface StoryTrayAuthor {
  author: StoryAuthor;
  hasUnseen: boolean;
  latestAt: string;
  // Oldest → newest, the order they play in.
  stories: Story[];
}

export interface StoryTray {
  authors: StoryTrayAuthor[];
}

export interface StoryHighlightsPage {
  items: Story[];
  nextCursor: string | null;
}

export interface StoryViewer extends StoryAuthor {
  viewedAt: string;
}

export interface StoryReactor extends StoryAuthor {
  type: ReactionType;
}

export interface StoryReply {
  id: string;
  fromUser: StoryAuthor;
  content: string;
  createdAt: string;
}

// Same audience rules as a post: one group, several (cross-post), or one
// group narrowed to a circle — never a circle with several groups.
export interface CreateStoryBody {
  imageUrl: string;
  groupId?: string;
  groupIds?: string[];
  circleId?: string | null;
}

// Empty/undefined groupIds = every group you belong to (same semantics as
// the feed's group filter).
function groupParams(groupIds?: string[]) {
  return groupIds && groupIds.length > 0 ? { groupIds: groupIds.join(',') } : {};
}

export async function fetchStoryTray(groupIds?: string[]): Promise<StoryTray> {
  const response = await api.get<StoryTray>('/stories', { params: groupParams(groupIds) });
  return response.data;
}

export async function fetchStoryHighlights(groupIds?: string[], cursor?: string): Promise<StoryHighlightsPage> {
  const response = await api.get<StoryHighlightsPage>('/stories/highlights', {
    params: { ...groupParams(groupIds), ...(cursor ? { cursor } : {}) },
  });
  return response.data;
}

export async function fetchStory(id: string): Promise<Story> {
  const response = await api.get<Story>(`/stories/${id}`);
  return response.data;
}

export async function createStory(body: CreateStoryBody): Promise<Story> {
  const response = await api.post<Story>('/stories', body);
  return response.data;
}

export async function markStoryViewed(id: string): Promise<void> {
  await api.post(`/stories/${id}/view`);
}

export async function fetchStoryViews(id: string): Promise<StoryViewer[]> {
  const response = await api.get<{ items: StoryViewer[] }>(`/stories/${id}/views`);
  return response.data.items;
}

// Same reaction again removes it; a different one switches it.
export async function reactToStory(id: string, type: ReactionType): Promise<{ myReaction: ReactionType | null }> {
  const response = await api.post<{ myReaction: ReactionType | null }>(`/stories/${id}/reaction`, { type });
  return response.data;
}

export async function fetchStoryReactions(id: string): Promise<StoryReactor[]> {
  const response = await api.get<{ items: StoryReactor[] }>(`/stories/${id}/reactions`);
  return response.data.items;
}

// One private reply per viewer, only while the story is live.
export async function replyToStory(id: string, content: string): Promise<{ content: string; createdAt: string }> {
  const response = await api.post<{ content: string; createdAt: string }>(`/stories/${id}/reply`, { content });
  return response.data;
}

export async function fetchStoryReplies(id: string): Promise<StoryReply[]> {
  const response = await api.get<{ items: StoryReply[] }>(`/stories/${id}/replies`);
  return response.data.items;
}

export async function pinStory(id: string): Promise<{ pinnedAt: string | null; deleted: boolean }> {
  const response = await api.post<{ pinnedAt: string | null; deleted: boolean }>(`/stories/${id}/pin`);
  return response.data;
}

// On an expired Highlight this DELETES the story (`deleted: true`) — confirm
// with the user first.
export async function unpinStory(id: string): Promise<{ pinnedAt: string | null; deleted: boolean }> {
  const response = await api.delete<{ pinnedAt: string | null; deleted: boolean }>(`/stories/${id}/pin`);
  return response.data;
}

export async function deleteStory(id: string): Promise<void> {
  await api.delete(`/stories/${id}`);
}

// Has this story's 24h window passed? Clients use it to drop a story from an
// open viewer/tray without waiting for a refetch.
export function isStoryLive(story: Pick<Story, 'expiresAt'>, now: Date = new Date()): boolean {
  return new Date(story.expiresAt).getTime() > now.getTime();
}
