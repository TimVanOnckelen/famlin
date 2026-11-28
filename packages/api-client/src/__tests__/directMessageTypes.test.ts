import { describe, expect, it } from 'vitest'
import type { NotificationPrefs, UpdateMeBody } from '../auth'
import type {
  ChatConversationMessage,
  ChatMessage,
  ChatMessageReply,
  CreateChatMessageBody,
  SendChatMessageBody,
} from '../chat'
import type { Notification, User } from '../types'

describe('direct-message profile and notification types', () => {
  it('uses the chat preference and keeps the conversation link explicit', () => {
    const userPreference: Pick<User, 'pushOnChitchat'> = { pushOnChitchat: true }
    const notificationPrefs: NotificationPrefs = { pushOnChitchat: true }
    const update: UpdateMeBody = { pushOnChitchat: false }
    const notification: Pick<Notification, 'relatedChatConversationId'> = {
      relatedChatConversationId: 'conversation-1',
    }

    expect({ userPreference, notificationPrefs, update, notification }).toEqual({
      userPreference: { pushOnChitchat: true },
      notificationPrefs: { pushOnChitchat: true },
      update: { pushOnChitchat: false },
      notification: { relatedChatConversationId: 'conversation-1' },
    })
  })

  it('shares the message input and reply preview without merging response contracts', () => {
    const body: SendChatMessageBody = {
      content: 'Reply',
      replyToMessageId: 'message-0',
    }
    const familyBody: CreateChatMessageBody = body
    const reply: ChatMessageReply = {
      id: 'message-0',
      authorId: 'user-2',
      authorName: 'Avery',
      kind: 'USER',
      content: 'Earlier message',
      attachmentUrl: null,
    }
    const familyMessage: Pick<ChatMessage, 'groupId' | 'readBy' | 'replyTo'> = {
      groupId: 'group-1',
      readBy: [],
      replyTo: reply,
    }
    const conversationMessage: Pick<
      ChatConversationMessage,
      'conversationId' | 'groupId' | 'encryption' | 'encryptedPayload' | 'replyTo'
    > = {
      conversationId: 'conversation-1',
      groupId: null,
      encryption: 'none',
      encryptedPayload: null,
      replyTo: reply,
    }

    expect({ familyBody, conversationMessageBody: body, familyMessage, conversationMessage }).toEqual({
      familyBody: body,
      conversationMessageBody: body,
      familyMessage: { groupId: 'group-1', readBy: [], replyTo: reply },
      conversationMessage: {
        conversationId: 'conversation-1',
        groupId: null,
        encryption: 'none',
        encryptedPayload: null,
        replyTo: reply,
      },
    })
  })
})
