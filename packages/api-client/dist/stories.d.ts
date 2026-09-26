import type { ReactionType } from './types';
export interface StoryAuthor {
    id: string;
    name: string;
    avatarUrl: string | null;
}
export interface Story {
    id: string;
    groupId: string;
    group: {
        id: string;
        name: string;
    };
    circleId: string | null;
    circle: {
        id: string;
        name: string;
    } | null;
    author: StoryAuthor;
    imageUrl: string;
    createdAt: string;
    expiresAt: string;
    pinnedAt: string | null;
    expired: boolean;
    isMine: boolean;
    seen: boolean;
    myReaction: ReactionType | null;
    myReply: {
        content: string;
        createdAt: string;
    } | null;
    stats: {
        viewCount: number;
        reactionCount: number;
        replyCount: number;
    } | null;
    sharedWithGroups?: {
        id: string;
        name: string;
    }[];
}
export interface StoryTrayAuthor {
    author: StoryAuthor;
    hasUnseen: boolean;
    latestAt: string;
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
export interface CreateStoryBody {
    imageUrl: string;
    groupId?: string;
    groupIds?: string[];
    circleId?: string | null;
}
export declare function fetchStoryTray(groupIds?: string[]): Promise<StoryTray>;
export declare function fetchStoryHighlights(groupIds?: string[], cursor?: string): Promise<StoryHighlightsPage>;
export declare function fetchStory(id: string): Promise<Story>;
export declare function createStory(body: CreateStoryBody): Promise<Story>;
export declare function markStoryViewed(id: string): Promise<void>;
export declare function fetchStoryViews(id: string): Promise<StoryViewer[]>;
export declare function reactToStory(id: string, type: ReactionType): Promise<{
    myReaction: ReactionType | null;
}>;
export declare function fetchStoryReactions(id: string): Promise<StoryReactor[]>;
export declare function replyToStory(id: string, content: string): Promise<{
    content: string;
    createdAt: string;
}>;
export declare function fetchStoryReplies(id: string): Promise<StoryReply[]>;
export declare function pinStory(id: string): Promise<{
    pinnedAt: string | null;
    deleted: boolean;
}>;
export declare function unpinStory(id: string): Promise<{
    pinnedAt: string | null;
    deleted: boolean;
}>;
export declare function deleteStory(id: string): Promise<void>;
export declare function isStoryLive(story: Pick<Story, 'expiresAt'>, now?: Date): boolean;
