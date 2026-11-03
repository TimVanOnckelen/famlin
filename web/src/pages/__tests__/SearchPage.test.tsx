import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, useNavigationType } from 'react-router'
import { SearchPage } from '../SearchPage'
import { useAppNavigation } from '@/utils/routes'
import { makePost, makeUser, renderWithQueryClient } from '@/test/fixtures'
import { fetchGroups, searchPosts } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  searchPosts: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null }),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
}))
const groups = [
  { id: 'group-1', name: 'First family', createdAt: '2026-01-01', chitchatEnabled: false },
  { id: 'group-2', name: 'Second family', createdAt: '2026-01-01', chitchatEnabled: false },
]
function Harness() {
  const location = useLocation()
  const type = useNavigationType()
  const nav = useAppNavigation()
  const background = (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation
  const params = new URLSearchParams((background ?? location).search)
  return (
    <>
      <SearchPage
        user={makeUser()}
        query={params.get('q') ?? ''}
        groupId={params.get('groupId') ?? ''}
        onSearchChange={nav.updateSearch}
        onOpenFeed={nav.toFeed}
        onOpenProfile={nav.toProfile}
        onOpenTrip={nav.toTrip}
        onOpenAlbum={nav.toAlbum}
        onLogout={() => {}}
      />
      <div data-testid="location">
        {location.pathname}
        {location.search}|{type}|{JSON.stringify(location.state)}
      </div>
    </>
  )
}
function renderPage(route = '/search') {
  return renderWithQueryClient(<Harness />, { route })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockResolvedValue(groups)
  vi.mocked(searchPosts).mockResolvedValue({ items: [makePost()], nextCursor: null })
})

it('defaults to the first family and waits for a nonempty query', async () => {
  renderPage()
  expect(await screen.findByText('Enter a search term to find posts in this family.')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('groupId=group-1|REPLACE'))
  expect(searchPosts).not.toHaveBeenCalled()
})

it('restores a shared query and family and loads subsequent cursors', async () => {
  vi.mocked(searchPosts)
    .mockResolvedValueOnce({ items: [makePost()], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [makePost({ id: 'second', content: 'Another match' })], nextCursor: null })
  renderPage('/search?q=garden&groupId=group-2')
  expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Second family' })).toHaveAttribute('aria-pressed', 'true')
  expect(searchPosts).toHaveBeenCalledWith({ groupId: 'group-2', q: 'garden', cursor: undefined })
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByText('Another match')).toBeInTheDocument()
  expect(searchPosts).toHaveBeenLastCalledWith({ groupId: 'group-2', q: 'garden', cursor: 'next' })
})

it('debounces typing and replaces the URL instead of adding history entries', async () => {
  renderPage('/search?groupId=group-1')
  await waitFor(() => expect(screen.getByRole('searchbox')).toBeEnabled())
  await userEvent.type(screen.getByRole('searchbox'), 'garden')
  expect(searchPosts).not.toHaveBeenCalled()
  expect(screen.getByTestId('location')).toHaveTextContent('/search?q=garden&groupId=group-1|REPLACE')
  await screen.findByText('Lovely day in the garden.')
  expect(searchPosts).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Second family' }))
  await waitFor(() =>
    expect(searchPosts).toHaveBeenLastCalledWith({ groupId: 'group-2', q: 'garden', cursor: undefined })
  )
})

it('opens a result as a post modal over the search URL', async () => {
  renderPage('/search?q=garden&groupId=group-1')
  await userEvent.click(await screen.findByRole('article'))
  const location = screen.getByTestId('location')
  expect(location).toHaveTextContent('/posts/post-1')
  expect(location).toHaveTextContent('backgroundLocation')
  expect(location).toHaveTextContent('?q=garden&groupId=group-1')
})

it('shows no matches and clears results when the query is cleared', async () => {
  vi.mocked(searchPosts).mockResolvedValue({ items: [], nextCursor: null })
  renderPage('/search?q=missing&groupId=group-1')
  expect(await screen.findByText('No posts found. Try a different search.')).toBeInTheDocument()
  await userEvent.clear(screen.getByRole('searchbox'))
  expect(screen.getByText('Enter a search term to find posts in this family.')).toBeInTheDocument()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('offers retry after a failed search', async () => {
  vi.mocked(searchPosts)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [makePost()], nextCursor: null })
  renderPage('/search?q=garden&groupId=group-1')
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load search results.')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument()
})

it('disables searching for a user without families', async () => {
  vi.mocked(fetchGroups).mockResolvedValue([])
  renderPage('/search?q=garden')
  expect(await screen.findByText('Join a family to search its posts.')).toBeInTheDocument()
  expect(screen.getByRole('searchbox')).toBeDisabled()
  expect(searchPosts).not.toHaveBeenCalled()
})
