import { QueryClient } from '@tanstack/react-query'
import { removeChatMessageFromCache } from '../chatCache'

it('removes a deleted message from every cached page without disturbing page cursors', () => {
  const client = new QueryClient()
  client.setQueryData(['chat-messages', 'private-1'], {
    pages: [
      {
        items: [
          { id: 'new', content: 'new' },
          { id: 'gone', content: 'gone' },
        ],
        nextCursor: 'cursor-1',
      },
      { items: [{ id: 'old', content: 'old' }], nextCursor: null },
    ],
    pageParams: [undefined, 'cursor-1'],
  })

  removeChatMessageFromCache(client, 'private-1', 'gone')

  expect(client.getQueryData(['chat-messages', 'private-1'])).toEqual({
    pages: [
      { items: [{ id: 'new', content: 'new' }], nextCursor: 'cursor-1' },
      { items: [{ id: 'old', content: 'old' }], nextCursor: null },
    ],
    pageParams: [undefined, 'cursor-1'],
  })
})
