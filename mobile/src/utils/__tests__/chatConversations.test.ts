import type { ChatConversation, ChatEligiblePerson } from '@famlin/api-client'
import { chatConversationPreview, chatConversationTitle, eligibleChatPeople } from '../chatConversations'

const person = (id: string, name: string): ChatEligiblePerson => ({ id, name, avatarUrl: null })

it('shows family and private inbox identities with safe plaintext previews', () => {
  const family: ChatConversation = {
    id: 'family-1',
    kind: 'FAMILY',
    group: { id: 'g1', name: 'Somoza' },
    participants: [person('me', 'Gabriel'), person('ana', 'Ana')],
    lastMessage: {
      id: 'm1',
      authorId: 'ana',
      content: 'Dinner at seven',
      hasAttachment: false,
      createdAt: '2026-11-23T18:00:00.000Z',
      encryption: 'none',
    },
    unreadCount: 1,
    updatedAt: '2026-11-23T18:00:00.000Z',
  }
  const privateConversation: ChatConversation = {
    ...family,
    id: 'private-1',
    kind: 'PRIVATE',
    group: null,
    participants: [person('me', 'Gabriel'), person('ana', 'Ana')],
  }

  expect(chatConversationTitle(family, 'me')).toBe('Somoza')
  expect(chatConversationTitle(privateConversation, 'me')).toBe('Ana')
  expect(chatConversationPreview(family)).toEqual({ key: 'chat.previewText', text: 'Dinner at seven' })
})

it('never infers a preview from unsupported encrypted conversation data', () => {
  const conversation = {
    id: 'private-1',
    kind: 'PRIVATE',
    participants: [person('me', 'Gabriel'), person('ana', 'Ana')],
    lastMessage: {
      id: 'm1',
      authorId: 'ana',
      content: 'do not expose',
      hasAttachment: true,
      createdAt: '2026-11-23T18:00:00.000Z',
      encryption: 'future-cipher',
    },
    unreadCount: 0,
    updatedAt: '2026-11-23T18:00:00.000Z',
  } satisfies ChatConversation

  expect(chatConversationPreview(conversation)).toEqual({ key: 'chat.unsupportedEncryption' })
})

it('filters recipient search by the authoritative list while excluding duplicates and self', () => {
  expect(
    eligibleChatPeople(
      [person('me', 'Gabriel'), person('ana', 'Ana'), person('ana', 'Ana duplicate'), person('bob', 'Bob')],
      'me',
      'an'
    )
  ).toEqual([person('ana', 'Ana')])
})
