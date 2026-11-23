import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
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

function conversation(id: string, kind: 'FAMILY' | 'PRIVATE', updatedAt: string) {
  return {
    id,
    kind,
    ...(kind === 'FAMILY' ? { group: { id: `g-${id}`, name: 'Family' } } : { group: null }),
    participants:
      kind === 'FAMILY'
        ? [{ id: 'me', name: 'Gabriel', avatarUrl: null }]
        : [
            { id: 'me', name: 'Gabriel', avatarUrl: null },
            { id: 'ana', name: 'Ana', avatarUrl: null },
          ],
    lastMessage: {
      id: `m-${id}`,
      authorId: 'ana',
      content: id === 'private' ? 'Hello' : 'Family news',
      hasAttachment: false,
      createdAt: updatedAt,
      encryption: id === 'private' ? 'future' : 'none',
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

it('renders the authoritative unified list newest-first and opens the correct routes', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({
    items: [
      conversation('family', 'FAMILY', '2026-11-23T17:00:00.000Z'),
      conversation('private', 'PRIVATE', '2026-11-23T18:00:00.000Z'),
    ],
  })

  await renderScreen()

  const names = await screen.findAllByTestId('chat-conversation-row')
  expect(names.map((row) => row.props.accessibilityLabel)).toEqual(['Ana', 'Family'])
  expect(await screen.findByText('chat.unsupportedEncryption')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()

  await fireEvent.press(names[0])
  expect(mockNavigate).toHaveBeenCalledWith('DirectMessage', { conversationId: 'private' })
  await fireEvent.press(names[1])
  expect(mockNavigate).toHaveBeenCalledWith('Chat', { groupId: 'g-family', groupName: 'Family' })

  await fireEvent.press(screen.getByLabelText('chat.newMessage'))
  expect(mockNavigate).toHaveBeenCalledWith('DmMemberPicker')
})

it('shows localized loading and error states without a secondary family source', async () => {
  jest.mocked(fetchChatConversations).mockRejectedValue(new Error('offline'))
  await renderScreen()

  expect(await screen.findByText('chat.inboxError')).toBeTruthy()
  expect(fetchChatConversations).toHaveBeenCalledTimes(1)
})
