import React from 'react'
import { Alert, Platform, StyleSheet } from 'react-native'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  deleteChatMessage,
  fetchChatConversationMessages,
  fetchChatConversations,
  sendChatConversationMessage,
  setApiBaseUrl,
  setMediaToken,
} from '@famlin/api-client'

const mockNavigate = jest.fn()
const mockMediaThumbnail = jest.fn((_props: unknown) => null)
let mockPanUpdate: ((event: { translationX: number }) => void) | undefined
let mockPanEnd: (() => void) | undefined
let mockComposerSend: ((body: { content?: string; attachmentUrl?: string }) => Promise<unknown>) | undefined
let mockConversationId = 'private-1'
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { conversationId: mockConversationId } }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require('react')
    React.useEffect(effect, [effect])
  },
}))
jest.mock('react-native-safe-area-context', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
  }
})
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/MediaThumbnail', () => ({ MediaThumbnail: (props: unknown) => mockMediaThumbnail(props) }))
jest.mock('@/components/ChatComposer', () => ({
  ChatComposer: ({ send }: { send: (body: { content?: string; attachmentUrl?: string }) => Promise<unknown> }) => {
    mockComposerSend = send
    return null
  },
}))
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        activeOffsetX: () => gesture,
        failOffsetY: () => gesture,
        onUpdate: (callback: (event: { translationX: number }) => void) => {
          mockPanUpdate = callback
          return gesture
        },
        onEnd: (callback: () => void) => {
          mockPanEnd = callback
          return gesture
        },
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
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => value,
    runOnJS: (fn: unknown) => fn,
  }
})
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'me' } }),
}))
// End-to-end behaviour has its own tests (src/e2e/__tests__); here the server has no encryption.
jest.mock('@/e2e/useDmCrypto', () => ({
  useDmCrypto: (_conversation: unknown, items: { id: string; encryption: string }[]) => ({
    e2e: { status: 'unsupported', myKeys: [], latestKeys: undefined },
    decision: { kind: 'plaintext', reason: 'unsupported' },
    rows: items.map((message) => ({ message, kind: message.encryption === 'none' ? 'plain' : 'unsupported' })),
    peerId: 'ana',
    verified: false,
    keyChanged: false,
    dismissKeyChange: jest.fn(),
  }),
}))
jest.mock('@/i18n/utils', () => ({ formatRelativeDate: () => 'now' }))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchChatConversations: jest.fn(),
  fetchChatConversationMessages: jest.fn(),
  markChatConversationRead: jest.fn().mockResolvedValue(undefined),
  deleteChatMessage: jest.fn(),
  sendChatConversationMessage: jest.fn(),
}))

import { DirectMessageScreen } from '../DirectMessageScreen'

const conversation = {
  id: 'private-1',
  kind: 'PRIVATE',
  group: null,
  participants: [
    { id: 'me', name: 'Gabriel', avatarUrl: null },
    { id: 'ana', name: 'Ana', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-11-23T18:00:00.000Z',
}

function message(id: string, authorId: string, encryption = 'none', attachmentUrl: string | null = null) {
  return {
    id,
    conversationId: 'private-1',
    groupId: null,
    authorId,
    author: { id: authorId, name: authorId === 'me' ? 'Gabriel' : 'Ana', avatarUrl: null },
    kind: 'USER' as const,
    content: `message-${id}`,
    attachmentUrl,
    refPostId: null,
    replyToMessageId: null,
    replyTo: null,
    createdAt: '2026-11-23T18:00:00.000Z',
    editedAt: null,
    encryption,
    encryptedPayload: null,
  }
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DirectMessageScreen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConversationId = 'private-1'
  mockPanUpdate = undefined
  mockPanEnd = undefined
  mockComposerSend = undefined
  setApiBaseUrl('https://famlin.test')
  setMediaToken('media-token')
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('keeps the composer at the bottom for a short conversation', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({ items: [], nextCursor: null })
  await renderScreen()

  const list = await screen.findByTestId('direct-message-list', {}, { timeout: 15000 })
  const listStyle = StyleSheet.flatten(list.props.style)
  expect(listStyle.flex).toBe(1)
  expect(screen.getByTestId('direct-message-screen').props.edges).toEqual(['top', 'left', 'right'])
  // The first render in this file is slow on CI; outlast the 15s findBy wait above.
}, 20000)

it('opens a video attachment with its authenticated original URL', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [message('video', 'ana', 'none', '/uploads/clip.mp4')],
    nextCursor: null,
  })
  await renderScreen()

  await screen.findByText('message-video')
  expect(mockMediaThumbnail).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://famlin.test/uploads/clip-thumbnail.jpg?token=media-token',
      fallbackUrl: 'https://famlin.test/uploads/clip.mp4?token=media-token',
    })
  )

  fireEvent.press(screen.getByLabelText('postDetail.viewAttachment'))
  expect(mockNavigate).toHaveBeenCalledWith('ImageViewer', {
    urls: ['https://famlin.test/uploads/clip.mp4?token=media-token'],
    initialIndex: 0,
  })
})

it('does not expose a delete control for someone elses message', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [message('theirs', 'ana')],
    nextCursor: null,
  })
  await renderScreen()

  expect(await screen.findByText('message-theirs')).toBeTruthy()
  expect(screen.queryByLabelText('chat.deleteMessage')).toBeNull()
})

it('swipes to quote a private message and sends the reply id', async () => {
  const original = {
    ...message('original', 'ana'),
    replyTo: {
      id: 'older',
      authorId: 'me',
      authorName: 'Gabriel',
      kind: 'USER' as const,
      content: 'Original text',
      attachmentUrl: null,
    },
  }
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [original],
    nextCursor: null,
  })
  jest.mocked(sendChatConversationMessage).mockResolvedValue({ ...original, id: 'reply' } as never)
  await renderScreen()

  expect(await screen.findByText('Original text')).toBeTruthy()
  const quoteTextStyle = StyleSheet.flatten(screen.getByTestId('chat-reply-quote-text').props.style)
  expect(quoteTextStyle.flex).toBeUndefined()
  expect(quoteTextStyle.flexShrink).toBe(1)
  await act(async () => {
    mockPanUpdate?.({ translationX: 40 })
    mockPanEnd?.()
  })
  expect(screen.getByText('chat.replyingTo')).toBeTruthy()

  await act(async () => {
    await mockComposerSend?.({ content: 'A private reply' })
  })
  expect(sendChatConversationMessage).toHaveBeenCalledWith('private-1', {
    content: 'A private reply',
    replyToMessageId: 'original',
  })
  expect(screen.queryByText('chat.replyingTo')).toBeNull()
})

it('deletes an own message only after destructive confirmation and repairs the cache', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [message('mine', 'me')],
    nextCursor: null,
  })
  jest.mocked(deleteChatMessage).mockResolvedValue(undefined)
  await renderScreen()

  expect(await screen.findByText('message-mine')).toBeTruthy()
  fireEvent.press(screen.getByLabelText('chat.deleteMessage'))

  expect(Alert.alert).toHaveBeenCalledWith('chat.deleteMessageTitle', 'chat.deleteMessageConfirm', expect.any(Array))
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2]
  buttons.find((button: any) => button.style === 'cancel').onPress?.()
  expect(deleteChatMessage).not.toHaveBeenCalled()

  await buttons.find((button: any) => button.style === 'destructive').onPress()

  await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith('mine'))
  await waitFor(() => expect(screen.queryByText('message-mine')).toBeNull())
})

it('shows unsupported encrypted content as a privacy-safe placeholder', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [message('future', 'ana', 'future-cipher')],
    nextCursor: null,
  })
  await renderScreen()

  expect(await screen.findByText('chat.unsupportedEncryption')).toBeTruthy()
  expect(screen.queryByText('message-future')).toBeNull()
})

it('keeps the empty state upright in the inverted message list', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [conversation] } as never)
  jest.mocked(fetchChatConversationMessages).mockResolvedValue({ items: [], nextCursor: null })
  await renderScreen()

  const emptyTitle = await screen.findByText('chat.emptyTitle')
  const emptyStateStyle = StyleSheet.flatten(emptyTitle.parent?.props.style)
  expect(emptyStateStyle.transform).toEqual(
    Platform.OS === 'android' ? [{ scaleX: -1 }, { scaleY: -1 }] : [{ scaleY: -1 }]
  )
})

it('renders a localized unavailable state for stale conversation access', async () => {
  jest.mocked(fetchChatConversations).mockResolvedValue({ items: [] })
  await renderScreen()

  expect(await screen.findByText('chat.conversationUnavailable')).toBeTruthy()
})
