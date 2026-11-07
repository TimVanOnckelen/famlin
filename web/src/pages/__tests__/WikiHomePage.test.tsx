import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiHomePage } from '../WikiHomePage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'
import { fetchGroups, fetchWikiCategories, fetchWikiPages, type WikiPageSummary } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchWikiPages: vi.fn(),
  fetchWikiCategories: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null }),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  fetchChatUnreadCounts: vi.fn().mockResolvedValue({}),
}))

const groups = [{ id: 'group-1', name: 'First family', createdAt: '2026-01-01', chitchatEnabled: false }]

function makeSummary(overrides: Partial<WikiPageSummary> = {}): WikiPageSummary {
  return {
    id: 'page-1',
    groupId: 'group-1',
    circle: null,
    title: "Grandma's lasagna",
    emoji: '🍝',
    category: 'Recipes',
    locked: false,
    excerpt: 'Layer it well.',
    createdBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    updatedBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
    ...overrides,
  }
}

function renderPage(props: Partial<Parameters<typeof WikiHomePage>[0]> = {}) {
  const handlers = {
    onFiltersChange: vi.fn(),
    onOpenPage: vi.fn(),
    onNewPage: vi.fn(),
  }
  renderWithQueryClient(
    <WikiHomePage
      user={makeUser()}
      groupId="group-1"
      query=""
      category={undefined}
      onOpenFeed={() => {}}
      onOpenProfile={() => {}}
      onLogout={() => {}}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockResolvedValue(groups)
  vi.mocked(fetchWikiCategories).mockResolvedValue([
    { name: 'Recipes', pageCount: 2 },
    { name: null, pageCount: 1 },
  ])
  vi.mocked(fetchWikiPages).mockResolvedValue({ items: [makeSummary()], nextCursor: null })
})

it('lists the pages of the family', async () => {
  renderPage()
  expect(await screen.findByText("Grandma's lasagna")).toBeInTheDocument()
  expect(screen.getByText('Layer it well.')).toBeInTheDocument()
  expect(fetchWikiPages).toHaveBeenCalledWith({
    groupId: 'group-1',
    q: undefined,
    category: undefined,
    cursor: undefined,
  })
})

it('reports typing in the search box through onFiltersChange', async () => {
  const { onFiltersChange } = renderPage()
  await screen.findByText("Grandma's lasagna")
  await userEvent.type(screen.getByRole('searchbox'), 'a')
  expect(onFiltersChange).toHaveBeenLastCalledWith({ groupId: 'group-1', q: 'a', category: undefined })
})

it('searches with the debounced query from the URL', async () => {
  renderPage({ query: ' lasagna ' })
  await screen.findByText("Grandma's lasagna")
  expect(fetchWikiPages).toHaveBeenLastCalledWith({
    groupId: 'group-1',
    q: 'lasagna',
    category: undefined,
    cursor: undefined,
  })
})

it('filters by a clicked category chip', async () => {
  const { onFiltersChange } = renderPage({ query: 'x' })
  const chips = within(await screen.findByRole('group', { name: 'Categories' }))
  await userEvent.click(chips.getByRole('button', { name: /Recipes/ }))
  expect(onFiltersChange).toHaveBeenCalledWith({ groupId: 'group-1', q: 'x', category: 'Recipes' })
  await userEvent.click(chips.getByRole('button', { name: /Uncategorized/ }))
  expect(onFiltersChange).toHaveBeenLastCalledWith({ groupId: 'group-1', q: 'x', category: '' })
})

it('opens a page when its row is clicked', async () => {
  const { onOpenPage } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Grandma's lasagna/ }))
  expect(onOpenPage).toHaveBeenCalledWith('page-1')
})

it('shows the empty state', async () => {
  vi.mocked(fetchWikiPages).mockResolvedValue({ items: [], nextCursor: null })
  renderPage()
  expect(await screen.findByText(/No pages yet/)).toBeInTheDocument()
})

it('shows the no-results state when filtering', async () => {
  vi.mocked(fetchWikiPages).mockResolvedValue({ items: [], nextCursor: null })
  renderPage({ category: 'Recipes' })
  expect(await screen.findByText('No pages match.')).toBeInTheDocument()
})

it('loads more pages', async () => {
  vi.mocked(fetchWikiPages)
    .mockResolvedValueOnce({ items: [makeSummary()], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [makeSummary({ id: 'page-2', title: 'Wi-Fi password' })], nextCursor: null })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  expect(await screen.findByText('Wi-Fi password')).toBeInTheDocument()
  expect(fetchWikiPages).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next' }))
})

it('calls onNewPage from the New page button', async () => {
  const { onNewPage } = renderPage({ category: 'Recipes' })
  await userEvent.click(await screen.findByRole('button', { name: 'New page' }))
  expect(onNewPage).toHaveBeenCalledWith('group-1', 'Recipes')
})
