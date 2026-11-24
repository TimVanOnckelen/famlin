import { describe, expect, it } from 'vitest'
import type { NotificationPrefs, UpdateMeBody } from '../auth'
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
})
