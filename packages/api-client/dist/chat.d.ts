export type ChatMessageKind = 'USER' | 'SYSTEM_MILESTONE';
export interface ChatMessage {
    id: string;
    groupId: string;
    authorId: string;
    author: {
        id: string;
        name: string;
        avatarUrl: string | null;
    };
    kind: ChatMessageKind;
    content: string | null;
    attachmentUrl: string | null;
    refPostId: string | null;
    createdAt: string;
    editedAt: string | null;
    readBy: {
        id: string;
        name: string;
        avatarUrl: string | null;
    }[];
}
export interface ChatMessagesPage {
    items: ChatMessage[];
    nextCursor: string | null;
}
export declare function fetchChatMessages(groupId: string, cursor?: string): Promise<ChatMessagesPage>;
export interface CreateChatMessageBody {
    content?: string;
    attachmentUrl?: string;
}
export declare function sendChatMessage(groupId: string, data: CreateChatMessageBody): Promise<ChatMessage>;
export declare function deleteChatMessage(messageId: string): Promise<void>;
export declare function markChatRead(groupId: string): Promise<void>;
export declare function fetchChatUnreadCounts(): Promise<Record<string, number>>;
