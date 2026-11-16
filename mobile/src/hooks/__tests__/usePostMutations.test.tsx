import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider, useInfiniteQuery, notifyManager } from '@tanstack/react-query'
import { reactToPost, toggleFavoritePost } from '@famlin/api-client'
import { Post } from '@/types'
import { useReactToPost, useToggleFavorite } from '../usePostMutations'

// React Query batches observer notifications through setTimeout by default;
// a batch scheduled by one test's mutation then fires inside the next test's
// render. Notify synchronously instead (the approach TanStack's own tests
// use) so every cache update lands within the act() that caused it.
notifyManager.setScheduler((callback) => callback())

jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  reactToPost: jest.fn(),
  toggleFavoritePost: jest.fn(),
}))

jest.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'me', name: 'Me', avatarUrl: null } }) },
}))

function makePost(overrides: Partial<Post>): Post {
  return {
    id: 'p1',
    authorId: 'u1',
    author: { id: 'u1', name: 'Alice' },
    groupId: 'g1',
    content: 'hello',
    type: 'UPDATE',
    uploadedAssetUrls: [],
    createdAt: new Date().toISOString(),
    commentCount: 0,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    favoritedByMe: false,
    ...overrides,
  }
}

const post1 = makePost({ id: 'p1' })
const post2 = makePost({ id: 'p2', likeCount: 5, myReaction: 'LIKE', reactions: { LIKE: 5 }, likedByMe: true })

let client: QueryClient

beforeEach(() => {
  jest.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  client.setQueryData(['post', 'p1'], post1)
})

afterEach(() => {
  client.clear()
})

// Mounts the feed and favorites infinite queries alongside the mutation hooks
// so invalidation-triggered refetches are observable as queryFn calls.
type Page = { items: Post[]; nextCursor: string | null }
async function setup(post: Post) {
  const feedQueryFn = jest.fn(async (): Promise<Page> => ({ items: [post1, post2], nextCursor: null }))
  const favoritesQueryFn = jest.fn(async (): Promise<Page> => ({ items: [post1], nextCursor: null }))
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const utils = await renderHook(
    () => ({
      feed: useInfiniteQuery({
        queryKey: ['posts', 'g1'],
        queryFn: feedQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
      }),
      favorites: useInfiniteQuery({
        queryKey: ['favorites'],
        queryFn: favoritesQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
      }),
      reaction: useReactToPost(post),
      favorite: useToggleFavorite(post),
    }),
    { wrapper }
  )
  return { ...utils, feedQueryFn, favoritesQueryFn }
}

describe('useReactToPost', () => {
  it('reconciles from the server response without refetching the feed', async () => {
    // Cross-post-merged counts the optimistic local math can't know.
    jest.mocked(reactToPost).mockResolvedValue({ myReaction: 'LOVE', counts: { LOVE: 2, LIKE: 1 } })
    const { result, feedQueryFn } = await setup(post1)
    await waitFor(() => expect(result.current.feed.data).toBeDefined())
    expect(feedQueryFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.reaction.mutate('LOVE')
    })
    await waitFor(() => expect(result.current.reaction.isSuccess).toBe(true))

    const items = result.current.feed.data!.pages[0].items
    expect(items[0].myReaction).toBe('LOVE')
    expect(items[0].reactions).toEqual({ LOVE: 2, LIKE: 1 })
    expect(items[0].likeCount).toBe(3)
    expect(items[0].likedByMe).toBe(true)
    expect(items[0].recentReactors?.[0]).toEqual({ id: 'me', name: 'Me', avatarUrl: null })
    // The single-post cache is reconciled too.
    expect(client.getQueryData<Post>(['post', 'p1'])?.likeCount).toBe(3)
    // Untouched posts keep their object identity (PostCard's React.memo holds).
    expect(items[1]).toBe(post2)
    // The whole point: no blanket ['posts'] invalidation refetch.
    expect(feedQueryFn).toHaveBeenCalledTimes(1)
  })

  it('un-reacting removes me from the reactor stack and zeroes the counts', async () => {
    const reacted = makePost({
      id: 'p1',
      myReaction: 'LOVE',
      reactions: { LOVE: 1 },
      likeCount: 1,
      likedByMe: true,
      recentReactors: [{ id: 'me', name: 'Me', avatarUrl: null }],
    })
    client.setQueryData(['post', 'p1'], reacted)
    jest.mocked(reactToPost).mockResolvedValue({ myReaction: null, counts: {} })
    const { result, feedQueryFn } = await setup(reacted)
    await waitFor(() => expect(result.current.feed.data).toBeDefined())

    await act(async () => {
      result.current.reaction.mutate('LOVE')
    })
    await waitFor(() => expect(result.current.reaction.isSuccess).toBe(true))

    const items = result.current.feed.data!.pages[0].items
    expect(items[0].myReaction).toBeNull()
    expect(items[0].likeCount).toBe(0)
    expect(items[0].likedByMe).toBe(false)
    expect(items[0].recentReactors).toEqual([])
    expect(feedQueryFn).toHaveBeenCalledTimes(1)
  })

  it('rolls the optimistic patch back via refetch when the request fails', async () => {
    jest.mocked(reactToPost).mockRejectedValue(new Error('offline'))
    const { result, feedQueryFn } = await setup(post1)
    await waitFor(() => expect(result.current.feed.data).toBeDefined())

    await act(async () => {
      result.current.reaction.mutate('LOVE')
    })
    await waitFor(() => expect(result.current.reaction.isError).toBe(true))

    // The error path invalidates, so the mounted feed refetches server truth.
    await waitFor(() => expect(feedQueryFn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.feed.data!.pages[0].items[0].myReaction).toBeNull())
  })
})

describe('useToggleFavorite', () => {
  it('reconciles favoritedByMe and refetches only the favorites list', async () => {
    jest.mocked(toggleFavoritePost).mockResolvedValue({ favorited: true })
    const { result, feedQueryFn, favoritesQueryFn } = await setup(post1)
    await waitFor(() => expect(result.current.feed.data).toBeDefined())
    await waitFor(() => expect(result.current.favorites.data).toBeDefined())
    expect(feedQueryFn).toHaveBeenCalledTimes(1)
    expect(favoritesQueryFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.favorite.mutate()
    })
    await waitFor(() => expect(result.current.favorite.isSuccess).toBe(true))

    expect(result.current.feed.data!.pages[0].items[0].favoritedByMe).toBe(true)
    expect(client.getQueryData<Post>(['post', 'p1'])?.favoritedByMe).toBe(true)
    // Feed untouched; the favorites list's membership changed, so it refetches.
    expect(feedQueryFn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(favoritesQueryFn).toHaveBeenCalledTimes(2))
  })

  it('rolls back via refetch when the request fails', async () => {
    jest.mocked(toggleFavoritePost).mockRejectedValue(new Error('offline'))
    const { result, feedQueryFn } = await setup(post1)
    await waitFor(() => expect(result.current.feed.data).toBeDefined())

    await act(async () => {
      result.current.favorite.mutate()
    })
    await waitFor(() => expect(result.current.favorite.isError).toBe(true))

    await waitFor(() => expect(feedQueryFn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.feed.data!.pages[0].items[0].favoritedByMe).toBe(false))
  })
})
