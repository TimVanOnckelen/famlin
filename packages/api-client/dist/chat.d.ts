export type ChatMessageKind = 'USER' | 'SYSTEM_MILESTONE';
export interface ChatMessageReply {
    id: string;
    authorId: string;
    authorName: string;
    kind: ChatMessageKind;
    content: string | null;
    attachmentUrl: string | null;
}
export declare const chatConversationsQueryKey: () => readonly ['chat-conversations'];
export declare const chatPeopleQueryKey: () => readonly ['chat-people'];
export declare const chatMessagesQueryKey: (conversationId: string) => readonly ['chat-messages', string];
export declare const chatUnreadConversationsQueryKey: () => readonly ['chat-unread-conversations'];
export declare function isChatEncryptionSupported(encryption: string): encryption is 'none';
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
    replyToMessageId: string | null;
    replyTo: ChatMessageReply | null;
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
export interface ChatEligiblePerson {
    id: string;
    name: string;
    avatarUrl: string | null;
}
export interface ChatPeoplePage {
    items: ChatEligiblePerson[];
}
export type ChatConversationKind = 'FAMILY' | 'PRIVATE';
export type ChatConversationParticipant = ChatEligiblePerson;
export interface ChatConversationLastMessage {
    id: string;
    authorId: string;
    content: string | null;
    hasAttachment: boolean;
    createdAt: string;
    encryption: string;
}
export interface ChatConversation {
    id: string;
    kind: ChatConversationKind;
    group?: {
        id: string;
        name: string;
    } | null;
    participants: ChatConversationParticipant[];
    lastMessage: ChatConversationLastMessage | null;
    unreadCount: number;
    updatedAt: string;
}
export type ChatConversationInboxItem = ChatConversation;
export interface ChatConversationsPage {
    items: ChatConversation[];
}
export type ChatConversationList = ChatConversationsPage;
export interface CreateChatConversationBody {
    kind: 'PRIVATE';
    participantIds: [string];
}
export declare function fetchChatPeople(): Promise<ChatPeoplePage>;
export declare function fetchChatConversations(): Promise<ChatConversationsPage>;
export declare function createChatConversation(data: CreateChatConversationBody): Promise<ChatConversation>;
export declare function fetchChatMessages(groupId: string, cursor?: string): Promise<ChatMessagesPage>;
export interface ChatConversationMessage {
    id: string;
    conversationId: string;
    groupId: string | null;
    authorId: string;
    author: ChatConversationParticipant;
    kind: ChatMessageKind;
    content: string | null;
    attachmentUrl: string | null;
    refPostId: string | null;
    replyToMessageId: string | null;
    replyTo: ChatMessageReply | null;
    createdAt: string;
    editedAt: string | null;
    encryption: string;
    encryptedPayload: unknown;
}
export interface ChatConversationMessagesPage {
    items: ChatConversationMessage[];
    nextCursor: string | null;
}
export interface FetchChatConversationMessagesParams {
    cursor?: string;
    take?: number;
}
export declare function fetchChatConversationMessages(conversationId: string, { cursor, take }?: FetchChatConversationMessagesParams): Promise<ChatConversationMessagesPage>;
export interface SendChatMessageBody {
    content?: string;
    attachmentUrl?: string;
    replyToMessageId?: string;
}
/** @deprecated Use SendChatMessageBody. This alias may be removed in the next breaking release. */
export type CreateChatMessageBody = SendChatMessageBody;
/** @deprecated Use SendChatMessageBody. This alias may be removed in the next breaking release. */
export type CreateChatConversationMessageBody = SendChatMessageBody;
export declare function sendChatConversationMessage(conversationId: string, data: SendChatMessageBody): Promise<ChatConversationMessage>;
export declare function sendChatMessage(groupId: string, data: SendChatMessageBody): Promise<ChatMessage>;
export declare function deleteChatMessage(messageId: string): Promise<void>;
export declare function markChatRead(groupId: string): Promise<void>;
export declare function markChatConversationRead(conversationId: string): Promise<void>;
export interface ChatConversationUnreadCounts {
    total: number;
    byConversation: Record<string, number>;
}
export declare function fetchChatConversationUnreadCounts(): Promise<ChatConversationUnreadCounts>;
export declare function fetchChatUnreadCounts(): Promise<Record<string, number>>;
