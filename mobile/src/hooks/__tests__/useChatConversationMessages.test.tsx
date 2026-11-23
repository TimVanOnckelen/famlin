import { act, renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'

const mockMarkRead = jest.fn()
const mockMarkLegacyRead = jest.fn()
const mockFetchMessages = jest.fn()

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require('react')
    React.useEffect(effect, [effect])
  },
}))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchChatConversationMessages: (...args: unknown[]) => mockFetchMessages(...args),
  markChatConversationRead: (...args: unknown[]) => mockMarkRead(...args),
  markChatRead: (...args: unknown[]) => mockMarkLegacyRead(...args),
}))

import { useChatConversationMessages } from '../useChatConversationMessages'

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.useRealTimers())

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

it('polls only the focused modern conversation and marks its newest state read', async () => {
  jest.useFakeTimers()
  mockFetchMessages.mockResolvedValue({
    items: [{ id: 'm1', conversationId: 'c1', createdAt: '2026-11-23T18:00:00.000Z' }],
    nextCursor: 'older',
  })
  mockMarkRead.mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })

  await renderHook(() => useChatConversationMessages({ conversationId: 'c1', modern: true }), {
    wrapper: wrapper(client),
  })

  await waitFor(() => expect(mockFetchMessages).toHaveBeenCalledWith('c1', {}))
  await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('c1'))
  const initialCalls = mockFetchMessages.mock.calls.length

  await act(async () => {
    jest.advanceTimersByTime(6000)
  })
  await waitFor(() => expect(mockFetchMessages.mock.calls.length).toBeGreaterThan(initialCalls))
  expect(mockMarkLegacyRead).not.toHaveBeenCalled()
})

it('keeps legacy family polling and read state on the group endpoints', async () => {
  jest.useFakeTimers()
  mockFetchMessages.mockResolvedValue({ items: [], nextCursor: null })
  mockMarkLegacyRead.mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })

  await renderHook(() => useChatConversationMessages({ groupId: 'g1', modern: false }), { wrapper: wrapper(client) })

  await waitFor(() => expect(mockMarkLegacyRead).toHaveBeenCalledWith('g1'))
  expect(mockMarkRead).not.toHaveBeenCalled()
})
