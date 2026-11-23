import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

describe('conversation-aware chat contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists eligible direct-message people through the public chat endpoint', async () => {
    const client = await import('../client.js')
    const response = { items: [{ id: 'user-2', name: 'Avery', avatarUrl: null }] }
    vi.mocked(client.api.get).mockResolvedValue({ data: response })

    const { fetchChatPeople } = await import('../chat.js')

    await expect(fetchChatPeople()).resolves.toEqual(response)
    expect(client.api.get).toHaveBeenCalledWith('/chat/people')
  })

  it('lists generalized family and private conversations', async () => {
    const client = await import('../client.js')
    const response = {
      items: [
        {
          id: 'conversation-1',
          kind: 'PRIVATE',
          participants: [{ id: 'user-2', name: 'Avery', avatarUrl: null }],
          lastMessage: null,
          unreadCount: 0,
          updatedAt: '2026-11-23T20:00:00.000Z',
        },
      ],
    }
    vi.mocked(client.api.get).mockResolvedValue({ data: response })

    const { fetchChatConversations } = await import('../chat.js')

    await expect(fetchChatConversations()).resolves.toEqual(response)
    expect(client.api.get).toHaveBeenCalledWith('/chat/conversations')
  })

  it('creates or reuses a private conversation with the backend body shape', async () => {
    const client = await import('../client.js')
    const conversation = {
      id: 'conversation-1',
      kind: 'PRIVATE',
      participants: [],
      lastMessage: null,
      unreadCount: 0,
      updatedAt: '2026-11-23T20:00:00.000Z',
    }
    vi.mocked(client.api.post).mockResolvedValue({ data: conversation })

    const { createChatConversation } = await import('../chat.js')
    const body = { kind: 'PRIVATE' as const, participantIds: ['user-2'] as [string] }

    await expect(createChatConversation(body)).resolves.toEqual(conversation)
    expect(client.api.post).toHaveBeenCalledWith('/chat/conversations', body)
  })

  it('fetches a conversation message page with cursor and take pagination', async () => {
    const client = await import('../client.js')
    const response = {
      items: [
        {
          id: 'message-1',
          conversationId: 'conversation-1',
          groupId: null,
          authorId: 'user-2',
          author: { id: 'user-2', name: 'Avery', avatarUrl: null },
          kind: 'USER',
          content: null,
          attachmentUrl: '/uploads/private.jpg',
          refPostId: null,
          createdAt: '2026-11-23T20:00:00.000Z',
          editedAt: null,
          encryption: 'future-cipher-v1',
          encryptedPayload: { ciphertext: 'opaque' },
        },
      ],
      nextCursor: 'older-cursor',
    }
    vi.mocked(client.api.get).mockResolvedValue({ data: response })

    const { fetchChatConversationMessages } = await import('../chat.js')

    await expect(
      fetchChatConversationMessages('conversation-1', { cursor: 'newer-cursor', take: 20 })
    ).resolves.toEqual(response)
    expect(client.api.get).toHaveBeenCalledWith('/chat/conversations/conversation-1/messages', {
      params: { cursor: 'newer-cursor', take: 20 },
    })
  })

  it('sends a text-and-attachment conversation message without legacy reply fields', async () => {
    const client = await import('../client.js')
    const message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      groupId: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Alex', avatarUrl: null },
      kind: 'USER',
      content: 'For you',
      attachmentUrl: '/uploads/photo.jpg',
      refPostId: null,
      createdAt: '2026-11-23T20:00:00.000Z',
      editedAt: null,
      encryption: 'none',
      encryptedPayload: null,
    }
    vi.mocked(client.api.post).mockResolvedValue({ data: message })

    const { sendChatConversationMessage } = await import('../chat.js')
    const body = { content: 'For you', attachmentUrl: '/uploads/photo.jpg' }

    await expect(sendChatConversationMessage('conversation-1', body)).resolves.toEqual(message)
    expect(client.api.post).toHaveBeenCalledWith('/chat/conversations/conversation-1/messages', body)
  })

  it('marks only the selected conversation read', async () => {
    const client = await import('../client.js')
    vi.mocked(client.api.post).mockResolvedValue({ data: { success: true } })

    const { markChatConversationRead } = await import('../chat.js')
    await markChatConversationRead('conversation-1')

    expect(client.api.post).toHaveBeenCalledWith('/chat/conversations/conversation-1/read')
  })

  it('fetches generalized total and per-conversation unread counts', async () => {
    const client = await import('../client.js')
    const response = {
      total: 3,
      byConversation: { 'conversation-1': 2, 'family-conversation-1': 1 },
    }
    vi.mocked(client.api.get).mockResolvedValue({ data: response })

    const { fetchChatConversationUnreadCounts } = await import('../chat.js')

    await expect(fetchChatConversationUnreadCounts()).resolves.toEqual(response)
    expect(client.api.get).toHaveBeenCalledWith('/chat/conversations/unread')
  })

  it('publishes stable conversation query keys shared by both clients', async () => {
    const { chatConversationsQueryKey, chatPeopleQueryKey, chatMessagesQueryKey, chatUnreadConversationsQueryKey } =
      await import('../chat.js')

    expect(chatConversationsQueryKey()).toEqual(['chat-conversations'])
    expect(chatPeopleQueryKey()).toEqual(['chat-people'])
    expect(chatMessagesQueryKey('conversation-1')).toEqual(['chat-messages', 'conversation-1'])
    expect(chatUnreadConversationsQueryKey()).toEqual(['chat-unread-conversations'])
  })

  it('treats only plaintext as a supported chat encryption marker', async () => {
    const { isChatEncryptionSupported } = await import('../chat.js')

    expect(isChatEncryptionSupported('none')).toBe(true)
    expect(isChatEncryptionSupported('future-cipher-v1')).toBe(false)
    expect(isChatEncryptionSupported('')).toBe(false)
  })
})

describe('legacy family chat contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves every existing route, body, and optional cursor shape', async () => {
    const client = await import('../client.js')
    vi.mocked(client.api.get).mockResolvedValue({ data: { items: [], nextCursor: null } })
    vi.mocked(client.api.post).mockResolvedValue({ data: { id: 'message-1' } })
    vi.mocked(client.api.delete).mockResolvedValue({ data: undefined })

    const { fetchChatMessages, sendChatMessage, deleteChatMessage, markChatRead, fetchChatUnreadCounts } =
      await import('../chat.js')
    const body = {
      content: 'Family update',
      attachmentUrl: '/uploads/family.jpg',
      replyToMessageId: 'message-0',
    }

    await fetchChatMessages('group-1')
    expect(client.api.get).toHaveBeenLastCalledWith('/chat/groups/group-1/messages', { params: undefined })

    await fetchChatMessages('group-1', 'cursor-1')
    expect(client.api.get).toHaveBeenLastCalledWith('/chat/groups/group-1/messages', {
      params: { cursor: 'cursor-1' },
    })

    await sendChatMessage('group-1', body)
    expect(client.api.post).toHaveBeenLastCalledWith('/chat/groups/group-1/messages', body)

    await deleteChatMessage('message-1')
    expect(client.api.delete).toHaveBeenCalledWith('/chat/messages/message-1')

    await markChatRead('group-1')
    expect(client.api.post).toHaveBeenLastCalledWith('/chat/groups/group-1/read')

    vi.mocked(client.api.get).mockResolvedValue({ data: { 'group-1': 2 } })
    await expect(fetchChatUnreadCounts()).resolves.toEqual({ 'group-1': 2 })
    expect(client.api.get).toHaveBeenLastCalledWith('/chat/unread-counts')
  })
})
