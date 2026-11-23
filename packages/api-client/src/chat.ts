import { api } from './client'

export type ChatMessageKind = 'USER' | 'SYSTEM_MILESTONE'

export const chatConversationsQueryKey = () => ['chat-conversations'] as const
export const chatPeopleQueryKey = () => ['chat-people'] as const
export const chatMessagesQueryKey = (conversationId: string) => ['chat-messages', conversationId] as const
export const chatUnreadConversationsQueryKey = () => ['chat-unread-conversations'] as const

export function isChatEncryptionSupported(encryption: string): encryption is 'none' {
  return encryption === 'none'
}

export interface ChatMessage {
  id: string
  groupId: string
  authorId: string
  author: {
    id: string
    name: string
    avatarUrl: string | null
  }
  kind: ChatMessageKind
  content: string | null
  attachmentUrl: string | null
  refPostId: string | null
  replyToMessageId: string | null
  replyTo: {
    id: string
    authorId: string
    authorName: string
    kind: ChatMessageKind
    content: string | null
    attachmentUrl: string | null
  } | null
  createdAt: string
  editedAt: string | null
  readBy: {
    id: string
    name: string
    avatarUrl: string | null
  }[]
}

export interface ChatMessagesPage {
  items: ChatMessage[]
  nextCursor: string | null
}

export interface ChatEligiblePerson {
  id: string
  name: string
  avatarUrl: string | null
}

export interface ChatPeoplePage {
  items: ChatEligiblePerson[]
}

export type ChatConversationKind = 'FAMILY' | 'PRIVATE'
export type ChatConversationParticipant = ChatEligiblePerson

export interface ChatConversationLastMessage {
  id: string
  authorId: string
  content: string | null
  hasAttachment: boolean
  createdAt: string
  encryption: string
}

export interface ChatConversation {
  id: string
  kind: ChatConversationKind
  group?: {
    id: string
    name: string
  } | null
  participants: ChatConversationParticipant[]
  lastMessage: ChatConversationLastMessage | null
  unreadCount: number
  updatedAt: string
}

export type ChatConversationInboxItem = ChatConversation

export interface ChatConversationsPage {
  items: ChatConversation[]
}

export type ChatConversationList = ChatConversationsPage

export interface CreateChatConversationBody {
  kind: 'PRIVATE'
  participantIds: [string]
}

export async function fetchChatPeople(): Promise<ChatPeoplePage> {
  // requires-feature: directMessages
  const response = await api.get<ChatPeoplePage>('/chat/people')
  return response.data
}

export async function fetchChatConversations(): Promise<ChatConversationsPage> {
  // requires-feature: directMessages
  const response = await api.get<ChatConversationsPage>('/chat/conversations')
  return response.data
}

export async function createChatConversation(data: CreateChatConversationBody): Promise<ChatConversation> {
  // requires-feature: directMessages
  const response = await api.post<ChatConversation>('/chat/conversations', data)
  return response.data
}

export async function fetchChatMessages(groupId: string, cursor?: string): Promise<ChatMessagesPage> {
  const response = await api.get<ChatMessagesPage>(`/chat/groups/${groupId}/messages`, {
    params: cursor ? { cursor } : undefined,
  })
  return response.data
}

export interface ChatConversationMessage {
  id: string
  conversationId: string
  groupId: string | null
  authorId: string
  author: ChatConversationParticipant
  kind: ChatMessageKind
  content: string | null
  attachmentUrl: string | null
  refPostId: string | null
  replyToMessageId?: string | null
  replyTo?: {
    id: string
    authorId: string
    authorName: string
    kind: ChatMessageKind
    content: string | null
    attachmentUrl: string | null
  } | null
  createdAt: string
  editedAt: string | null
  encryption: string
  encryptedPayload: unknown
}

export interface ChatConversationMessagesPage {
  items: ChatConversationMessage[]
  nextCursor: string | null
}

export interface FetchChatConversationMessagesParams {
  cursor?: string
  take?: number
}

export async function fetchChatConversationMessages(
  conversationId: string,
  { cursor, take }: FetchChatConversationMessagesParams = {}
): Promise<ChatConversationMessagesPage> {
  // requires-feature: directMessages
  const response = await api.get<ChatConversationMessagesPage>(`/chat/conversations/${conversationId}/messages`, {
    params: {
      ...(cursor ? { cursor } : {}),
      ...(take !== undefined ? { take } : {}),
    },
  })
  return response.data
}

export interface CreateChatMessageBody {
  content?: string
  attachmentUrl?: string
  replyToMessageId?: string
}

export interface CreateChatConversationMessageBody {
  content?: string
  attachmentUrl?: string
  replyToMessageId?: string
}

export async function sendChatConversationMessage(
  conversationId: string,
  data: CreateChatConversationMessageBody
): Promise<ChatConversationMessage> {
  // requires-feature: directMessages
  const response = await api.post<ChatConversationMessage>(`/chat/conversations/${conversationId}/messages`, data)
  return response.data
}

export async function sendChatMessage(groupId: string, data: CreateChatMessageBody): Promise<ChatMessage> {
  const response = await api.post<ChatMessage>(`/chat/groups/${groupId}/messages`, data)
  return response.data
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  await api.delete(`/chat/messages/${messageId}`)
}

export async function markChatRead(groupId: string): Promise<void> {
  await api.post(`/chat/groups/${groupId}/read`)
}

export async function markChatConversationRead(conversationId: string): Promise<void> {
  // requires-feature: directMessages
  await api.post(`/chat/conversations/${conversationId}/read`)
}

export interface ChatConversationUnreadCounts {
  total: number
  byConversation: Record<string, number>
}

export async function fetchChatConversationUnreadCounts(): Promise<ChatConversationUnreadCounts> {
  // requires-feature: directMessages
  const response = await api.get<ChatConversationUnreadCounts>('/chat/conversations/unread')
  return response.data
}

export async function fetchChatUnreadCounts(): Promise<Record<string, number>> {
  const response = await api.get<Record<string, number>>('/chat/unread-counts')
  return response.data
}
