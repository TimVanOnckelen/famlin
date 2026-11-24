import { describe, expect, it } from 'vitest'
import type {
  ChatConversation,
  ChatConversationInboxItem,
  ChatConversationLastMessage,
  ChatConversationList,
  ChatConversationMessage,
  ChatConversationMessagesPage,
  ChatConversationParticipant,
  ChatConversationUnreadCounts,
  ChatConversationsPage,
  ChatEligiblePerson,
  ChatMessageReply,
  ChatPeoplePage,
  CreateChatConversationBody,
  CreateChatMessageBody,
  FetchChatConversationMessagesParams,
  SendChatMessageBody,
} from '../index'

type NamedConversationTypes = [
  ChatEligiblePerson,
  ChatConversationParticipant,
  ChatConversationLastMessage,
  ChatConversation,
  ChatConversationInboxItem,
  ChatConversationsPage,
  ChatConversationList,
  ChatConversationUnreadCounts,
  CreateChatConversationBody,
  ChatConversationMessage,
  ChatConversationMessagesPage,
  FetchChatConversationMessagesParams,
  CreateChatMessageBody,
  SendChatMessageBody,
  ChatMessageReply,
  ChatPeoplePage,
]

describe('conversation-aware named exports', () => {
  it('exposes every public transport, predicate, and query-key helper', async () => {
    const client = await import('../index.js')
    const types: NamedConversationTypes | undefined = undefined

    expect(types).toBeUndefined()
    expect(client).toMatchObject({
      fetchChatPeople: expect.any(Function),
      fetchChatConversations: expect.any(Function),
      createChatConversation: expect.any(Function),
      fetchChatConversationMessages: expect.any(Function),
      sendChatConversationMessage: expect.any(Function),
      markChatConversationRead: expect.any(Function),
      fetchChatConversationUnreadCounts: expect.any(Function),
      deleteChatMessage: expect.any(Function),
      isChatEncryptionSupported: expect.any(Function),
      chatConversationsQueryKey: expect.any(Function),
      chatPeopleQueryKey: expect.any(Function),
      chatMessagesQueryKey: expect.any(Function),
      chatUnreadConversationsQueryKey: expect.any(Function),
    })
  })
})
