import { Post, PollCreateData, PostReactor, PostType, ReactionType } from './types';
export interface FetchPostsParams {
    groupIds?: string[];
    cursor?: string;
}
export interface PostsPage {
    items: Post[];
    nextCursor: string | null;
}
export declare function fetchPosts(params?: FetchPostsParams): Promise<PostsPage>;
export declare function fetchPost(postId: string): Promise<Post>;
export declare function fetchOnThisDay(groupId: string): Promise<Post[]>;
export interface SearchPostsParams {
    groupId: string;
    q: string;
    cursor?: string;
}
export declare function searchPosts(params: SearchPostsParams): Promise<PostsPage>;
export declare function fetchFavorites(cursor?: string): Promise<PostsPage>;
export interface CreatePostBody {
    groupId: string;
    groupIds?: string[];
    content?: string;
    type: PostType;
    typeData?: PollCreateData | Record<string, unknown>;
    milestoneTag?: string;
    uploadedAssetUrls: string[];
    latitude?: number;
    longitude?: number;
    locationName?: string;
}
export declare function createPost(data: CreatePostBody): Promise<Post>;
export declare function updatePost(postId: string, content: string): Promise<Post>;
export declare function deletePost(postId: string): Promise<void>;
export interface ReactionResult {
    myReaction: ReactionType | null;
    counts: Partial<Record<ReactionType, number>>;
}
export declare function reactToPost(postId: string, type: ReactionType): Promise<ReactionResult>;
export declare function fetchPostReactions(postId: string): Promise<PostReactor[]>;
export declare function toggleFavoritePost(postId: string): Promise<{
    favorited: boolean;
}>;
export declare function interactWithPost(postId: string, key: string, value?: unknown): Promise<Post>;
export declare function votePoll(postId: string, optionId: string): Promise<Post>;
