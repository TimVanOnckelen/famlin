export declare const REACTION_TYPES: readonly ["LIKE", "LOVE", "HAHA", "WOW", "SAD", "CARE"];
export type ReactionType = (typeof REACTION_TYPES)[number];
export interface PostReactor {
    id: string;
    name: string;
    avatarUrl?: string | null;
    type: ReactionType;
}
export interface PostPerson {
    id: string;
    provider: string;
    label: string;
    userId: string | null;
    userName: string | null;
    userAvatarUrl: string | null;
}
export type PostType = 'UPDATE' | 'MILESTONE' | 'POLL' | (string & {});
export interface PollOptionResult {
    id: string;
    text: string;
    voteCount: number;
    voters: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    }[];
}
export interface PostPoll {
    options: PollOptionResult[];
    totalVotes: number;
    myVoteOptionId: string | null;
    closesAt: string | null;
    closed: boolean;
}
export interface PollCreateData {
    options: {
        text: string;
    }[];
    closesAt?: string;
}
export interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    isAdmin: boolean;
    hasPassword: boolean;
    emailOnNewPost: boolean;
    emailOnNewComment: boolean;
    emailOnNewLike: boolean;
    pushOnNewPost: boolean;
    pushOnNewComment: boolean;
    pushOnNewLike: boolean;
}
export interface Group {
    id: string;
    name: string;
    description?: string | null;
    createdAt: string;
    joinedAt?: string;
    allowedPostTypes?: string[];
    chitchatEnabled: boolean;
}
export interface Post {
    id: string;
    authorId: string;
    author: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    };
    groupId: string;
    group?: {
        id: string;
        name: string;
    } | null;
    content?: string | null;
    type: PostType;
    typeData?: unknown;
    poll?: PostPoll;
    milestoneTag?: string | null;
    uploadedAssetUrls: string[];
    createdAt: string;
    editedAt?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    locationName?: string | null;
    commentCount: number;
    likeCount: number;
    likedByMe: boolean;
    myReaction: ReactionType | null;
    reactions: Partial<Record<ReactionType, number>>;
    recentReactors?: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    }[];
    favoritedByMe: boolean;
    people?: PostPerson[];
    sharedWithGroups?: {
        id: string;
        name: string;
    }[];
}
export interface Comment {
    id: string;
    postId: string;
    authorId: string;
    author: {
        id: string;
        name: string;
        avatarUrl?: string | null;
    };
    content: string;
    createdAt: string;
    editedAt?: string | null;
    parentId?: string | null;
    assetUrl?: string | null;
    attachmentUrl?: string | null;
    likeCount: number;
    likedByMe: boolean;
    myReaction: ReactionType | null;
    reactions: Partial<Record<ReactionType, number>>;
}
export interface Notification {
    id: string;
    type: string;
    relatedPostId?: string | null;
    message: string;
    readAt?: string | null;
    createdAt: string;
    post?: {
        id: string;
        groupId: string;
    } | null;
}
