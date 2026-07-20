import { api } from './client';

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
  replyToMessageId: string | null;
  replyTo: {
    id: string;
    authorId: string;
    authorName: string;
    kind: ChatMessageKind;
    content: string | null;
    attachmentUrl: string | null;
  } | null;
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

export async function fetchChatMessages(
  groupId: string,
  cursor?: string,
): Promise<ChatMessagesPage> {
  const response = await api.get<ChatMessagesPage>(`/chat/groups/${groupId}/messages`, {
    params: cursor ? { cursor } : undefined,
  });
  return response.data;
}

export interface CreateChatMessageBody {
  content?: string;
  attachmentUrl?: string;
  replyToMessageId?: string;
}

export async function sendChatMessage(
  groupId: string,
  data: CreateChatMessageBody,
): Promise<ChatMessage> {
  const response = await api.post<ChatMessage>(`/chat/groups/${groupId}/messages`, data);
  return response.data;
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  await api.delete(`/chat/messages/${messageId}`);
}

export async function markChatRead(groupId: string): Promise<void> {
  await api.post(`/chat/groups/${groupId}/read`);
}

export async function fetchChatUnreadCounts(): Promise<Record<string, number>> {
  const response = await api.get<Record<string, number>>('/chat/unread-counts');
  return response.data;
}
