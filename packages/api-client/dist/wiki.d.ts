export interface WikiPerson {
    id: string;
    name: string;
    avatarUrl: string | null;
}
export interface WikiPageSummary {
    id: string;
    groupId: string;
    circle: {
        id: string;
        name: string;
    } | null;
    title: string;
    emoji: string | null;
    category: string | null;
    locked: boolean;
    excerpt: string;
    createdBy: WikiPerson | null;
    updatedBy: WikiPerson | null;
    createdAt: string;
    updatedAt: string;
}
export interface WikiPage extends WikiPageSummary {
    content: string;
    canEdit: boolean;
    canManage: boolean;
}
export interface WikiCategory {
    name: string | null;
    pageCount: number;
}
export interface WikiPageListParams {
    groupId: string;
    q?: string;
    category?: string;
    cursor?: string;
    take?: number;
}
export declare function fetchWikiPages(params: WikiPageListParams): Promise<{
    items: WikiPageSummary[];
    nextCursor: string | null;
}>;
export declare function fetchWikiCategories(groupId: string): Promise<WikiCategory[]>;
export declare function fetchWikiPage(pageId: string): Promise<WikiPage>;
export interface CreateWikiPageBody {
    groupId: string;
    circleId?: string | null;
    title: string;
    emoji?: string | null;
    category?: string | null;
    content?: string;
    locked?: boolean;
}
export declare function createWikiPage(body: CreateWikiPageBody): Promise<WikiPage>;
export interface UpdateWikiPageBody {
    title?: string;
    emoji?: string | null;
    category?: string | null;
    content?: string;
    locked?: boolean;
    baseUpdatedAt?: string;
}
export declare function updateWikiPage(pageId: string, body: UpdateWikiPageBody): Promise<WikiPage>;
export declare function deleteWikiPage(pageId: string): Promise<void>;
export declare function wikiConflictPage(err: unknown): WikiPage | null;
