import { describe, expect, it } from 'vitest'
import type { NotificationPrefs, UpdateMeBody } from '../auth'
import type { Notification, User } from '../types'

describe('direct-message profile and notification types', () => {
  it('keeps the direct-message preference and conversation link explicit', () => {
    const userPreference: Pick<User, 'pushOnDirectMessage'> = { pushOnDirectMessage: true }
    const notificationPrefs: NotificationPrefs = { pushOnDirectMessage: true }
    const update: UpdateMeBody = { pushOnDirectMessage: false }
    const notification: Pick<Notification, 'relatedChatConversationId'> = {
      relatedChatConversationId: 'conversation-1',
    }

    expect({ userPreference, notificationPrefs, update, notification }).toEqual({
      userPreference: { pushOnDirectMessage: true },
      notificationPrefs: { pushOnDirectMessage: true },
      update: { pushOnDirectMessage: false },
      notification: { relatedChatConversationId: 'conversation-1' },
    })
  })
})
