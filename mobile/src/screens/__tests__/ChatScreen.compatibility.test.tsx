import React from 'react'
import { Platform, StyleSheet } from 'react-native'
import { render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { sendChatConversationMessage, sendChatMessage } from '@famlin/api-client'

const mockUseChatConversationMessages = jest.fn()
let mockSupport: 'supported' | 'unsupported' = 'supported'
let mockComposerSend: ((body: object) => Promise<unknown>) | undefined

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { groupId: 'g1', groupName: 'Family' } }),
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/MediaThumbnail', () => ({ MediaThumbnail: () => null }))
jest.mock('@/components/ReactorStack', () => ({ ReactorStack: () => null }))
jest.mock('@/components/EmptyState', () => {
  const React = require('react')
  const { Text, View } = require('react-native')
  return {
    EmptyState: ({ title, style }: { title: string; style?: unknown }) =>
      React.createElement(View, { style }, React.createElement(Text, null, title)),
  }
})
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        activeOffsetX: () => gesture,
        failOffsetY: () => gesture,
        onUpdate: () => gesture,
        onEnd: () => gesture,
      }
      return gesture
    },
  },
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: { View: ({ children }: { children: React.ReactNode }) => children },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withSpring: (value: unknown) => value,
    runOnJS: (fn: unknown) => fn,
  }
})
jest.mock('@/components/ChatComposer', () => ({
  ChatComposer: ({ send }: { send: (body: object) => Promise<unknown> }) => {
    mockComposerSend = send
    return null
  },
}))
jest.mock('@/i18n/utils', () => ({ formatRelativeDate: () => 'now' }))
jest.mock('@/hooks/useServerInfo', () => ({
  useServerFeatureSupport: () => mockSupport,
}))
jest.mock('@/hooks/useChatConversationMessages', () => ({
  useChatConversationMessages: (options: unknown) => mockUseChatConversationMessages(options),
}))
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'me' } }),
}))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchChatConversations: jest.fn().mockResolvedValue({
    items: [{ id: 'conversation-1', kind: 'FAMILY', group: { id: 'g1', name: 'Family' }, participants: [] }],
  }),
  fetchGroupMembers: jest.fn().mockResolvedValue([]),
  sendChatMessage: jest.fn().mockResolvedValue({ id: 'legacy' }),
  sendChatConversationMessage: jest.fn().mockResolvedValue({ id: 'modern' }),
}))

import { ChatScreen } from '../ChatScreen'

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ChatScreen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUseChatConversationMessages.mockReturnValue({
    query: { isLoading: false, isFetchingNextPage: false },
    items: [],
    onEndReached: jest.fn(),
    unavailable: false,
  })
})

it('uses the generalized family conversation contract on capable servers', async () => {
  mockSupport = 'supported'
  await renderScreen()
  await waitFor(() =>
    expect(mockUseChatConversationMessages).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      modern: true,
    })
  )
  await mockComposerSend!({ content: 'hello' })
  expect(sendChatConversationMessage).toHaveBeenCalledWith('conversation-1', { content: 'hello' })
  expect(sendChatMessage).not.toHaveBeenCalled()
})

it('keeps old-server family chat on the legacy route contract', async () => {
  mockSupport = 'unsupported'
  await renderScreen()
  expect(mockUseChatConversationMessages).toHaveBeenCalledWith({
    groupId: 'g1',
    modern: false,
  })
  await mockComposerSend!({ content: 'hello' })
  expect(sendChatMessage).toHaveBeenCalledWith('g1', {
    content: 'hello',
    replyToMessageId: undefined,
  })
  expect(sendChatConversationMessage).not.toHaveBeenCalled()
})

it('sizes a reply bubble from the intrinsic width of its quote', async () => {
  mockSupport = 'supported'
  mockUseChatConversationMessages.mockReturnValue({
    query: { isLoading: false, isFetchingNextPage: false },
    items: [
      {
        id: 'reply',
        authorId: 'me',
        author: { id: 'me', name: 'Me', avatarUrl: null },
        kind: 'USER',
        content: 'Ok!',
        attachmentUrl: null,
        refPostId: null,
        readBy: [],
        replyTo: {
          id: 'original',
          authorId: 'dad',
          authorName: 'Dad',
          kind: 'USER',
          content: 'This is a much longer quoted message',
          attachmentUrl: null,
        },
        createdAt: '2026-11-25T16:00:00.000Z',
      },
    ],
    onEndReached: jest.fn(),
    unavailable: false,
  })

  await renderScreen()

  const quoteTextStyle = StyleSheet.flatten((await screen.findByTestId('chat-reply-quote-text')).props.style)
  expect(quoteTextStyle.flex).toBeUndefined()
  expect(quoteTextStyle.flexShrink).toBe(1)
})

it('keeps the empty state upright in the inverted family chat list', async () => {
  mockSupport = 'supported'

  await renderScreen()

  const emptyTitle = await screen.findByText('chat.emptyTitle')
  const emptyStateStyle = StyleSheet.flatten(emptyTitle.parent?.props.style)
  expect(emptyStateStyle.transform).toEqual(
    Platform.OS === 'android' ? [{ scaleX: -1 }, { scaleY: -1 }] : [{ scaleY: -1 }]
  )
})
