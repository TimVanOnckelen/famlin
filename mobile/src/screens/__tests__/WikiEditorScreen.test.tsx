import React from 'react'
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigation = { goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() }
let mockParams: Record<string, string> = {}
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockParams }),
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images' } }))
jest.mock('@/hooks/usePickAndUploadMedia', () => ({
  usePickAndUploadMedia: () => ({ pick: jest.fn(), uploading: false }),
}))
jest.mock('@/components/WikiContent', () => ({ WikiContent: () => null }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/i18n/utils', () => ({ formatRelativeDate: () => 'just now' }))

jest.mock('@famlin/api-client', () => ({
  createWikiPage: jest.fn(),
  updateWikiPage: jest.fn(),
  fetchGroups: jest.fn(),
  fetchMyCircles: jest.fn(),
  fetchWikiCategories: jest.fn(),
  fetchWikiPage: jest.fn(),
  fetchPosts: jest.fn(),
  searchPosts: jest.fn(),
  wikiPostLabel: (post: any, fallback: string) => post.content || fallback,
  wikiPostLinkMarkdown: (post: any, label: string) => `[${label}](/posts/${post.id})`,
  wikiConflictPage: (err: any) => (err?.response?.status === 409 ? err.response.data.page : null),
}))

import {
  createWikiPage,
  fetchPosts,
  fetchGroups,
  fetchMyCircles,
  fetchWikiCategories,
  fetchWikiPage,
  updateWikiPage,
} from '@famlin/api-client'
import { WikiEditorScreen } from '@/screens/WikiEditorScreen'

function wikiPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    groupId: 'g1',
    circle: null,
    title: 'Lasagna',
    emoji: null,
    category: null,
    locked: false,
    excerpt: '',
    createdBy: null,
    updatedBy: { id: 'u2', name: 'Bob', avatarUrl: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    content: 'mine',
    canEdit: true,
    canManage: true,
    ...overrides,
  }
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WikiEditorScreen />
    </QueryClientProvider>
  )
}

describe('WikiEditorScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fetchGroups as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'Family' }])
    ;(fetchWikiCategories as jest.Mock).mockResolvedValue([{ name: 'Recipes', pageCount: 2 }])
    ;(fetchMyCircles as jest.Mock).mockResolvedValue([])
  })

  it('creates a page with trimmed fields and replaces itself with the page', async () => {
    mockParams = { groupId: 'g1' }
    ;(createWikiPage as jest.Mock).mockResolvedValue(wikiPage({ id: 'new1' }))
    await renderScreen()

    await fireEvent.changeText(screen.getByLabelText('wiki.titleLabel'), '  Pasta  ')
    await fireEvent.changeText(screen.getByLabelText('wiki.categoryLabel'), ' Recipes ')
    await fireEvent.changeText(screen.getByLabelText('wiki.contentLabel'), 'Boil water')
    await fireEvent.press(screen.getByText('wiki.save'))

    await waitFor(() =>
      expect(createWikiPage).toHaveBeenCalledWith({
        groupId: 'g1',
        circleId: null,
        title: 'Pasta',
        emoji: null,
        category: 'Recipes',
        content: 'Boil water',
        locked: false,
      })
    )
    await waitFor(() => expect(mockNavigation.replace).toHaveBeenCalledWith('WikiPage', { pageId: 'new1' }))
  })

  it('does not save without a title', async () => {
    mockParams = { groupId: 'g1' }
    await renderScreen()
    await fireEvent.press(screen.getByText('wiki.save'))
    expect(createWikiPage).not.toHaveBeenCalled()
  })

  it('offers the conflict choices on a 409 and resends with their updatedAt', async () => {
    mockParams = { pageId: 'p1' }
    ;(fetchWikiPage as jest.Mock).mockResolvedValue(wikiPage())
    const theirs = wikiPage({ updatedAt: '2026-01-03T00:00:00.000Z', content: 'theirs' })
    ;(updateWikiPage as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 409, data: { page: theirs } } })
      .mockResolvedValueOnce(theirs)
    await renderScreen()

    await waitFor(() => expect(screen.getByLabelText('wiki.titleLabel').props.value).toBe('Lasagna'))
    await fireEvent.press(screen.getByText('wiki.save'))

    expect(await screen.findByText('wiki.conflictTakeTheirs')).toBeTruthy()
    expect(updateWikiPage).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ baseUpdatedAt: '2026-01-02T00:00:00.000Z' })
    )

    await fireEvent.press(screen.getByText('wiki.conflictKeepMine'))
    await waitFor(() => expect(updateWikiPage).toHaveBeenCalledTimes(2))
    expect(updateWikiPage).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ content: 'mine', baseUpdatedAt: '2026-01-03T00:00:00.000Z' })
    )
    await waitFor(() => expect(mockNavigation.goBack).toHaveBeenCalled())
  })

  it('loads theirs when discarding mine', async () => {
    mockParams = { pageId: 'p1' }
    ;(fetchWikiPage as jest.Mock).mockResolvedValue(wikiPage())
    const theirs = wikiPage({ updatedAt: '2026-01-03T00:00:00.000Z', content: 'theirs', title: 'Their title' })
    ;(updateWikiPage as jest.Mock).mockRejectedValueOnce({ response: { status: 409, data: { page: theirs } } })
    await renderScreen()

    await waitFor(() => expect(screen.getByLabelText('wiki.titleLabel').props.value).toBe('Lasagna'))
    await fireEvent.press(screen.getByText('wiki.save'))
    await fireEvent.press(await screen.findByText('wiki.conflictTakeTheirs'))

    await waitFor(() => expect(screen.getByLabelText('wiki.titleLabel').props.value).toBe('Their title'))
    expect(screen.queryByText('wiki.conflictKeepMine')).toBeNull()
  })

  it('replaces the remembered selection with a link to the picked post', async () => {
    mockParams = { groupId: 'g1' }
    ;(fetchPosts as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'post9',
          type: 'UPDATE',
          content: 'Summer party',
          createdAt: '2026-01-01T00:00:00.000Z',
          author: { id: 'u1', name: 'Alice', avatarUrl: null },
        },
      ],
      nextCursor: null,
    })
    await renderScreen()

    const input = screen.getByLabelText('wiki.contentLabel')
    await fireEvent.changeText(input, 'see our party now')
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 8, end: 13 } } })
    await fireEvent.press(screen.getByLabelText('wiki.fmtLinkPost'))

    await fireEvent.press(await screen.findByText('Summer party'))
    expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['g1'] })
    await waitFor(() =>
      expect(screen.getByLabelText('wiki.contentLabel').props.value).toBe('see our [party](/posts/post9) now')
    )
  })
})
