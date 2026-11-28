import type { ChatConversation, ChatEligiblePerson } from '@famlin/api-client'
import {
  chatConversationPreview,
  chatConversationSections,
  chatConversationTitle,
  eligibleChatPeople,
} from '../chatConversations'

const person = (id: string, name: string): ChatEligiblePerson => ({ id, name, avatarUrl: null })

function inboxConversation(id: string, kind: 'FAMILY' | 'PRIVATE', updatedAt: string): ChatConversation {
  return {
    id,
    kind,
    group: kind === 'FAMILY' ? { id: `g-${id}`, name: id } : null,
    participants: [person('me', 'Gabriel'), person(`${id}-other`, id)],
    lastMessage: null,
    unreadCount: 0,
    updatedAt,
  }
}

it('groups family chats before private messages and sorts each section newest-first', () => {
  const sections = chatConversationSections([
    inboxConversation('private-old', 'PRIVATE', '2026-11-21T10:00:00.000Z'),
    inboxConversation('family-old', 'FAMILY', '2026-11-20T10:00:00.000Z'),
    inboxConversation('private-new', 'PRIVATE', '2026-11-24T10:00:00.000Z'),
    inboxConversation('family-new', 'FAMILY', '2026-11-23T10:00:00.000Z'),
  ])

  expect(sections.map((section) => section.key)).toEqual(['family', 'private'])
  expect(sections.map((section) => section.data.map((conversation) => conversation.id))).toEqual([
    ['family-new', 'family-old'],
    ['private-new', 'private-old'],
  ])
})

it('omits an empty conversation section', () => {
  expect(
    chatConversationSections([inboxConversation('private', 'PRIVATE', '2026-11-24T10:00:00.000Z')]).map(
      (section) => section.key
    )
  ).toEqual(['private'])
})

it('filters chat names immediately by any case-insensitive substring', () => {
  const family = {
    ...inboxConversation('family', 'FAMILY', '2026-11-24T10:00:00.000Z'),
    group: { id: 'g-family', name: 'Foo Bar' },
  }
  const privateConversation = {
    ...inboxConversation('private', 'PRIVATE', '2026-11-23T10:00:00.000Z'),
    participants: [person('me', 'Gabriel'), person('ana', 'Barbara')],
  }

  expect(chatConversationSections([family, privateConversation], 'me', 'bAr').map((section) => section.key)).toEqual([
    'family',
    'private',
  ])
  expect(
    chatConversationSections([family, privateConversation], 'me', 'o b').flatMap((section) => section.data)
  ).toEqual([family])
})

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
