import type { GiftListItem, Post } from './types';
export declare function fetchMyGiftLists(): Promise<Post[]>;
export declare function fetchGiftListItems(postId: string): Promise<GiftListItem[]>;
export interface GiftListItemBody {
    title: string;
    note?: string | null;
    url?: string | null;
    photoUrl?: string | null;
}
export declare function createGiftListItem(postId: string, body: GiftListItemBody): Promise<GiftListItem>;
export declare function updateGiftListItem(postId: string, itemId: string, body: Partial<GiftListItemBody>): Promise<GiftListItem>;
export declare function deleteGiftListItem(postId: string, itemId: string): Promise<void>;
export declare function reorderGiftListItems(postId: string, itemIds: string[]): Promise<GiftListItem[]>;
export interface GiftListSettingsBody {
    title?: string;
    occasionDate?: string | null;
    drawEnabled?: boolean;
    budget?: string | null;
    exclusions?: Array<[string, string]>;
    confirmRedraw?: boolean;
}
export declare function updateGiftListSettings(postId: string, body: GiftListSettingsBody): Promise<Post>;
export declare function setGiftListParticipants(postId: string, userIds: string[], confirmRedraw?: boolean): Promise<Post>;
export declare function drawGiftList(postId: string): Promise<Post>;
export declare function leaveGiftList(postId: string): Promise<void>;
export declare function isGiftDrawResetConflict(err: unknown): boolean;
