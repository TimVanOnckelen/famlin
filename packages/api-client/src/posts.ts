import { api } from './client';
import { Post, PollCreateData, PostReactor, PostType, ReactionType, TripTypeData } from './types';

export interface FetchPostsParams {
  // Subset of the user's groups to show; omit (or pass empty) for all of them.
  groupIds?: string[];
  cursor?: string;
}

export interface PostsPage {
  items: Post[];
  nextCursor: string | null;
}

export async function fetchPosts(params: FetchPostsParams = {}): Promise<PostsPage> {
  const response = await api.get<PostsPage>('/posts', {
    params: {
      groupIds: params.groupIds && params.groupIds.length > 0 ? params.groupIds.join(',') : undefined,
      cursor: params.cursor,
    },
  });
  return response.data;
}

export async function fetchPost(postId: string): Promise<Post> {
  const response = await api.get<Post>(`/posts/${postId}`);
  return response.data;
}

export async function fetchOnThisDay(groupId: string): Promise<Post[]> {
  const response = await api.get<{ items: Post[] }>('/posts/on-this-day', { params: { groupId } });
  return response.data.items;
}

export interface SearchPostsParams {
  groupId: string;
  q: string;
  cursor?: string;
}

export async function searchPosts(params: SearchPostsParams): Promise<PostsPage> {
  const response = await api.get<PostsPage>('/posts/search', { params });
  return response.data;
}

export async function fetchFavorites(cursor?: string): Promise<PostsPage> {
  const response = await api.get<PostsPage>('/favorites', { params: { cursor } });
  return response.data;
}

export interface CreatePostBody {
  groupId: string;
  // Cross-post targets: when set (2+ groups), the server creates one post per
  // group that behaves as a single post for the author (shared edit/delete),
  // while comments and reactions stay scoped to each group. groupId is still
  // required for older servers that don't know groupIds.
  groupIds?: string[];
  content?: string;
  type: PostType;
  // Handler-owned config for custom post types, e.g. poll options
  // ({ options: [{ text }], closesAt? }) or a trip's title/destination/dates;
  // absent/undefined for UPDATE/MILESTONE. TRIP posts cross-post like every
  // other type (groupIds 1–20), with each travelerUserId required to be a
  // member of every target group.
  typeData?: PollCreateData | TripTypeData | Record<string, unknown>;
  milestoneTag?: string;
  uploadedAssetUrls: string[];
  latitude?: number;
  longitude?: number;
  locationName?: string;
}

export async function createPost(data: CreatePostBody): Promise<Post> {
  const response = await api.post<Post>('/posts', data);
  return response.data;
}

export async function updatePost(postId: string, content: string): Promise<Post> {
  const response = await api.patch<Post>(`/posts/${postId}`, { content });
  return response.data;
}

export async function deletePost(postId: string): Promise<void> {
  await api.delete(`/posts/${postId}`);
}

// What the reaction endpoints actually return — not the full Post/Comment.
// Callers keep list caches fresh via optimistic patches + invalidation
// (see patchPostInCaches) rather than merging this result in.
export interface ReactionResult {
  myReaction: ReactionType | null;
  counts: Partial<Record<ReactionType, number>>;
}

export async function reactToPost(postId: string, type: ReactionType): Promise<ReactionResult> {
  const response = await api.post<ReactionResult>(`/posts/${postId}/like`, { type });
  return response.data;
}

// Every reactor and which emoji they left, newest first — used by the "who
// reacted with what" view, as opposed to Post.recentReactors (top 3, no type).
export async function fetchPostReactions(postId: string): Promise<PostReactor[]> {
  const response = await api.get<{ items: PostReactor[] }>(`/posts/${postId}/reactions`);
  return response.data.items;
}

export async function toggleFavoritePost(postId: string): Promise<{ favorited: boolean }> {
  const response = await api.post<{ favorited: boolean }>(`/posts/${postId}/favorite`);
  return response.data;
}

// Generic per-post-type interaction endpoint (e.g. poll voting). Returns the
// full shaped + enriched post so callers can refresh their cache in one round
// trip — see votePoll() below for the poll-specific convenience wrapper.
export async function interactWithPost(postId: string, key: string, value?: unknown): Promise<Post> {
  const response = await api.post<Post>(`/posts/${postId}/interactions`, { key, value });
  return response.data;
}

// Voting the same option again unvotes; voting a different option switches —
// mirrors reaction semantics. See PostTypeHandler.interact on the backend.
export async function votePoll(postId: string, optionId: string): Promise<Post> {
  return interactWithPost(postId, 'vote', { optionId });
}

export interface CheckInTripBody {
  place: string;
  text?: string;
  // Already-uploaded paths (POST /api/uploads first, same flow as post
  // photos) — not raw files, this endpoint doesn't accept multipart data.
  photoUrls?: string[];
}

// Adds a check-in to an active trip. Allowed for the post author or any
// designated co-traveler (see setTripTravelers below); the server rejects
// anyone else (errors.tripNotTraveler) and closed trips (errors.tripClosed).
// Returns the full shaped + enriched post, same contract as votePoll — the
// check-in itself is persisted as a Comment with
// `metadata: { kind: 'trip_checkin', ... }` (see fetchComments), so callers
// should also refresh the post's comments after this resolves.
export async function checkInTrip(postId: string, data: CheckInTripBody): Promise<Post> {
  return interactWithPost(postId, 'checkin', data);
}

// Closes a trip (author only, irreversible): flips `trip.closed`, and the
// timeline reverses to oldest-first client-side. Returns the full shaped +
// enriched post.
export async function closeTrip(postId: string): Promise<Post> {
  return interactWithPost(postId, 'close');
}

// Replaces the trip's co-traveler list (author only, active trips only) —
// userIds are group members, max 20, and must NOT include the author (who is
// implicitly a traveler). Server errors: errors.tripNotAuthor,
// errors.tripTravelerNotMember, errors.tripClosed. Returns the full shaped +
// enriched post (its trip.travelers reflecting the new list).
export async function setTripTravelers(postId: string, userIds: string[]): Promise<Post> {
  return interactWithPost(postId, 'setTravelers', { userIds });
}
