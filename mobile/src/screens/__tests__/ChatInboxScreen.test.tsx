import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchChatConversations } from '@famlin/api-client'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/i18n/utils', () => ({ formatRelativeDate: (value: string) => value }))
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'me' } }),
}))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchChatConversations: jest.fn(),
}))

import { ChatInboxScreen } from '../ChatInboxScreen'

function conversation(id: string, kind: 'FAMILY' | 'PRIVATE', updatedAt: string, label = id) {
  return {
    id,
    kind,
    ...(kind === 'FAMILY' ? { group: { id: `g-${id}`, name: label } } : { group: null }),
    participants:
      kind === 'FAMILY'
        ? [{ id: 'me', name: 'Gabriel', avatarUrl: null }]
        : [
            { id: 'me', name: 'Gabriel', avatarUrl: null },
            { id: `other-${id}`, name: label, avatarUrl: null },
          ],
    lastMessage: {
      id: `m-${id}`,
      authorId: 'ana',
      content: id === 'private' ? 'Hello' : 'Family news',
      hasAttachment: false,
      createdAt: updatedAt,
      encryption: kind === 'PRIVATE' ? 'future' : 'none',
    },
    unreadCount: id === 'private' ? 2 : 0,
    updatedAt,
  }
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ChatInboxScreen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('renders family chats first, then private messages, newest-first within each section', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({
    items: [
      conversation('private-old', 'PRIVATE', '2026-11-21T18:00:00.000Z', 'Private old'),
      conversation('family-old', 'FAMILY', '2026-11-20T17:00:00.000Z', 'Family old'),
      conversation('private-new', 'PRIVATE', '2026-11-24T18:00:00.000Z', 'Private new'),
      conversation('family-new', 'FAMILY', '2026-11-23T17:00:00.000Z', 'Family new'),
    ],
  })

  await renderScreen()

  const names = await screen.findAllByTestId('chat-conversation-row')
  expect(names.map((row) => row.props.accessibilityLabel)).toEqual([
    'Family new',
    'Family old',
    'Private new',
    'Private old',
  ])
  expect(screen.getByTestId('chat-family-section')).toHaveTextContent('chat.familyChats')
  expect(screen.getByTestId('chat-private-section')).toHaveTextContent('chat.privateMessages')
  expect(screen.getAllByTestId(/chat-(family|private)-section/).map((section) => section.props.testID)).toEqual([
    'chat-family-section',
    'chat-private-section',
  ])
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getAllByText('chat.unsupportedEncryption')).toHaveLength(2)

  await fireEvent.press(names[0])
  expect(mockNavigate).toHaveBeenCalledWith('Chat', { groupId: 'g-family-new', groupName: 'Family new' })
  await fireEvent.press(names[2])
  expect(mockNavigate).toHaveBeenCalledWith('DirectMessage', { conversationId: 'private-new' })

  await fireEvent.press(screen.getByLabelText('chat.newMessage'))
  expect(mockNavigate).toHaveBeenCalledWith('DmMemberPicker')
})

it('filters chats as the user types and removes empty section headers', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({
    items: [
      conversation('family', 'FAMILY', '2026-11-23T17:00:00.000Z', 'Foo Bar'),
      conversation('private', 'PRIVATE', '2026-11-24T18:00:00.000Z', 'Ana'),
    ],
  })
  await renderScreen()

  const search = await screen.findByLabelText('chat.searchChats')
  await screen.findAllByTestId('chat-conversation-row')
  expect(search.props.clearButtonMode).toBe('while-editing')
  fireEvent.changeText(search, 'bAr')

  await waitFor(() =>
    expect(screen.getAllByTestId('chat-conversation-row').map((row) => row.props.accessibilityLabel)).toEqual([
      'Foo Bar',
    ])
  )
  expect(screen.getByTestId('chat-family-section')).toBeTruthy()
  expect(screen.queryByTestId('chat-private-section')).toBeNull()

  fireEvent.changeText(search, 'missing')

  await waitFor(() => {
    expect(screen.queryByTestId('chat-family-section')).toBeNull()
    expect(screen.queryByTestId('chat-private-section')).toBeNull()
    expect(screen.getByText('search.emptyTitle')).toBeTruthy()
  })
})

it('shows localized loading and error states without a secondary family source', async () => {
  jest.mocked(fetchChatConversations).mockRejectedValue(new Error('offline'))
  await renderScreen()

  expect(await screen.findByText('chat.inboxError')).toBeTruthy()
  expect(fetchChatConversations).toHaveBeenCalledTimes(1)
})
