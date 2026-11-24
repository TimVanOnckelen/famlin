import React, { useEffect, useMemo, useRef } from 'react'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatMessagesQueryKey,
  chatUnreadConversationsQueryKey,
  fetchChatConversationMessages,
  fetchChatMessages,
  markChatConversationRead,
  markChatRead,
  type ChatConversationMessage,
  type ChatMessage,
} from '@famlin/api-client'

const CHAT_POLL_INTERVAL_MS = 6000

type ConversationFeedMessage = ChatConversationMessage | ChatMessage
interface ConversationFeedPage {
  items: ConversationFeedMessage[]
  nextCursor: string | null
}

type ConversationFeedOptions = { modern: true; conversationId: string } | { modern: false; groupId: string }

export function useChatConversationMessages(options: ConversationFeedOptions) {
  const modern = options.modern
  const conversationId = options.modern ? options.conversationId : undefined
  const groupId = options.modern ? undefined : options.groupId
  const queryClient = useQueryClient()
  const isFocused = useIsFocused()
  const lastReadNewestId = useRef<string | undefined>(undefined)
  const queryKey = modern ? chatMessagesQueryKey(conversationId ?? '') : ['chatMessages', groupId ?? '']

  const query = useInfiniteQuery<
    ConversationFeedPage,
    Error,
    InfiniteData<ConversationFeedPage, string | undefined>,
    readonly string[],
    string | undefined
  >({
    queryKey,
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      if (options.modern) {
        return fetchChatConversationMessages(options.conversationId, pageParam ? { cursor: pageParam } : {})
      }
      return fetchChatMessages(options.groupId, pageParam)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: modern ? !!conversationId : !!groupId,
  })
  const items = useMemo(
    () => (query.data?.pages.flatMap((page) => page.items) ?? []) as ConversationFeedMessage[],
    [query.data]
  )
  const newestId = items[0]?.id
  const refetch = query.refetch

  const markRead = React.useCallback(async () => {
    if (modern) {
      if (!conversationId) return
      await markChatConversationRead(conversationId)
      await queryClient.invalidateQueries({ queryKey: chatUnreadConversationsQueryKey() })
    } else {
      if (!groupId) return
      await markChatRead(groupId)
      await queryClient.invalidateQueries({ queryKey: ['chat-unread'] })
    }
  }, [conversationId, groupId, modern, queryClient])

  useFocusEffect(
    React.useCallback(() => {
      void markRead().catch(() => {})
      const interval = setInterval(() => {
        void refetch()
      }, CHAT_POLL_INTERVAL_MS)
      return () => clearInterval(interval)
    }, [markRead, refetch])
  )

  useEffect(() => {
    if (!isFocused || !newestId || lastReadNewestId.current === newestId) return
    lastReadNewestId.current = newestId
    void markRead().catch(() => {})
  }, [isFocused, markRead, newestId])

  function onEndReached() {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }

  const status = (query.error as { response?: { status?: number } } | null)?.response?.status

  return {
    query,
    items,
    onEndReached,
    unavailable: status === 403 || status === 404,
  }
}
