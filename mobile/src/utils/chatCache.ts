import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { chatMessagesQueryKey, type ChatConversationMessagesPage } from '@famlin/api-client'

export function removeChatMessageFromCache(queryClient: QueryClient, conversationId: string, messageId: string) {
  queryClient.setQueryData<InfiniteData<ChatConversationMessagesPage>>(
    chatMessagesQueryKey(conversationId),
    (current) => {
      if (!current) return current
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.filter((message) => message.id !== messageId),
        })),
      }
    }
  )
}
