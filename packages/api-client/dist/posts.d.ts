import { AlbumTypeData, Post, PollCreateData, PostReactor, PostType, ReactionType, TripTypeData } from './types';
export interface FetchPostsParams {
    groupIds?: string[];
    cursor?: string;
    type?: PostType;
}
export interface PostsPage {
    items: Post[];
    nextCursor: string | null;
}
export declare function fetchPosts(params?: FetchPostsParams): Promise<PostsPage>;
export declare function fetchAlbumPosts(params?: {
    groupIds?: string[];
    cursor?: string;
}): Promise<PostsPage>;
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
    typeData?: PollCreateData | TripTypeData | AlbumTypeData | Record<string, unknown>;
    milestoneTag?: string;
    uploadedAssetUrls: string[];
    latitude?: number;
    longitude?: number;
    locationName?: string;
}
export declare function createPost(data: CreatePostBody): Promise<Post>;
export interface UpdatePostBody {
    content?: string;
    milestoneTag?: string;
    uploadedAssetUrls?: string[];
    latitude?: number | null;
    longitude?: number | null;
    locationName?: string | null;
}
export declare function updatePost(postId: string, data: UpdatePostBody): Promise<Post>;
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
export interface CheckInTripBody {
    place: string;
    text?: string;
    photoUrls?: string[];
}
export declare function checkInTrip(postId: string, data: CheckInTripBody): Promise<Post>;
export declare function closeTrip(postId: string): Promise<Post>;
export declare function setTripTravelers(postId: string, userIds: string[]): Promise<Post>;
export interface AddAlbumPhotosBody {
    photoUrls: string[];
    caption?: string;
}
export declare function addAlbumPhotos(postId: string, data: AddAlbumPhotosBody): Promise<Post>;
export declare function closeAlbum(postId: string): Promise<Post>;
