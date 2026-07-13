import { api } from './client';
import { Post, ReactionType } from './types';

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
  type: 'UPDATE' | 'MILESTONE';
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

export async function toggleFavoritePost(postId: string): Promise<{ favorited: boolean }> {
  const response = await api.post<{ favorited: boolean }>(`/posts/${postId}/favorite`);
  return response.data;
}
