import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiArticlePage } from '../WikiArticlePage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'
import { deleteWikiPage, fetchGroups, fetchWikiPage, type WikiPage } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null }),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  fetchChatUnreadCounts: vi.fn().mockResolvedValue({}),
}))

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    groupId: 'group-1',
    circle: null,
    title: "Grandma's lasagna",
    emoji: '🍝',
    category: 'Recipes',
    locked: false,
    excerpt: 'Layer it well.',
    content: '## Steps\n\nLayer it well.',
    canEdit: true,
    canManage: true,
    createdBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    updatedBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  const handlers = { onBack: vi.fn(), onEdit: vi.fn(), onDeleted: vi.fn() }
  renderWithQueryClient(
    <WikiArticlePage
      user={makeUser()}
      pageId="page-1"
      onOpenFeed={() => {}}
      onOpenProfile={() => {}}
      onLogout={() => {}}
      {...handlers}
    />
  )
  return handlers
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockResolvedValue([])
  vi.mocked(fetchWikiPage).mockResolvedValue(makePage())
  vi.mocked(deleteWikiPage).mockResolvedValue()
})

it('renders the title and content', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { level: 1, name: /Grandma's lasagna/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 3, name: 'Steps' })).toBeInTheDocument()
  expect(screen.getByText('Recipes')).toBeInTheDocument()
  expect(fetchWikiPage).toHaveBeenCalledWith('page-1')
})

it('shows Edit only when canEdit and calls onEdit', async () => {
  const { onEdit } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  expect(onEdit).toHaveBeenCalledWith('page-1')
})

it('hides Edit and Delete without permission', async () => {
  vi.mocked(fetchWikiPage).mockResolvedValue(makePage({ canEdit: false, canManage: false, locked: true }))
  renderPage()
  await screen.findByRole('heading', { level: 1 })
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
})

it('hides Delete without canManage', async () => {
  vi.mocked(fetchWikiPage).mockResolvedValue(makePage({ canManage: false }))
  renderPage()
  await screen.findByRole('button', { name: 'Edit' })
  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
})

it('asks for confirmation before deleting, then calls onDeleted with the group', async () => {
  const { onDeleted } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(deleteWikiPage).not.toHaveBeenCalled()
  expect(screen.getByText(/Delete this page for everyone/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('group-1'))
  expect(deleteWikiPage).toHaveBeenCalledWith('page-1')
})

it('cancelling the confirmation deletes nothing', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText(/Delete this page for everyone/)).not.toBeInTheDocument()
  expect(deleteWikiPage).not.toHaveBeenCalled()
})

it('shows an error and keeps the page when deleting fails', async () => {
  vi.mocked(deleteWikiPage).mockRejectedValue(new Error('nope'))
  const { onDeleted } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText("Couldn't delete the page.")).toBeInTheDocument()
  expect(onDeleted).not.toHaveBeenCalled()
})

it('shows the not-available message when the fetch fails', async () => {
  vi.mocked(fetchWikiPage).mockRejectedValue({ response: { status: 404 } })
  renderPage()
  expect(await screen.findByText(/This page isn't available/)).toBeInTheDocument()
})
