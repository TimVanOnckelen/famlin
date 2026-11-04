import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiEditorPage } from '../WikiEditorPage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'
import {
  createWikiPage,
  fetchGroups,
  fetchMyCircles,
  fetchWikiCategories,
  fetchWikiPage,
  updateWikiPage,
  type WikiPage,
} from '@famlin/api-client'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchMyCircles: vi.fn(),
  fetchWikiCategories: vi.fn(),
  fetchWikiPage: vi.fn(),
  createWikiPage: vi.fn(),
  updateWikiPage: vi.fn(),
  uploadFiles: vi.fn(),
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
    content: 'Layer it well.',
    canEdit: true,
    canManage: true,
    createdBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    updatedBy: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
    ...overrides,
  }
}

function renderPage(props: Partial<Parameters<typeof WikiEditorPage>[0]> = {}) {
  const handlers = { onCancel: vi.fn(), onSaved: vi.fn() }
  const utils = renderWithQueryClient(
    <WikiEditorPage
      user={makeUser()}
      onOpenFeed={() => {}}
      onOpenProfile={() => {}}
      onLogout={() => {}}
      {...handlers}
      {...props}
    />
  )
  return { ...handlers, unmount: utils.unmount }
}

const conflictError = (page: WikiPage) => ({ response: { status: 409, data: { page } } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockResolvedValue([
    { id: 'group-1', name: 'First family', createdAt: '2026-01-01', chitchatEnabled: false },
  ])
  vi.mocked(fetchMyCircles).mockResolvedValue([])
  vi.mocked(fetchWikiCategories).mockResolvedValue([])
  vi.mocked(fetchWikiPage).mockResolvedValue(makePage())
})

it('creates a page with trimmed fields and reports the new id', async () => {
  vi.mocked(createWikiPage).mockResolvedValue(makePage({ id: 'new-1' }))
  const { onSaved } = renderPage({ groupId: 'group-1' })
  await userEvent.type(await screen.findByLabelText('Title'), '  Wi-Fi  ')
  await userEvent.type(screen.getByLabelText('Icon'), ' 📶 ')
  await userEvent.type(screen.getByLabelText('Category'), ' House ')
  await userEvent.type(screen.getByLabelText('Page content'), 'Password: abc')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-1'))
  expect(createWikiPage).toHaveBeenCalledWith({
    groupId: 'group-1',
    circleId: null,
    title: 'Wi-Fi',
    emoji: '📶',
    category: 'House',
    content: 'Password: abc',
    locked: false,
  })
})

it('cannot save without a title', async () => {
  renderPage({ groupId: 'group-1' })
  await screen.findByLabelText('Title')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('shows an error when saving fails', async () => {
  vi.mocked(createWikiPage).mockRejectedValue(new Error('boom'))
  const { onSaved } = renderPage({ groupId: 'group-1' })
  await userEvent.type(await screen.findByLabelText('Title'), 'X')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText("Couldn't save the page.")).toBeInTheDocument()
  expect(onSaved).not.toHaveBeenCalled()
})

it('previews the Markdown', async () => {
  renderPage({ groupId: 'group-1' })
  await userEvent.type(await screen.findByLabelText('Page content'), '## Hello')
  await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
  expect(screen.getByRole('heading', { level: 3, name: 'Hello' })).toBeInTheDocument()
})

it('seeds the form when editing and sends baseUpdatedAt', async () => {
  vi.mocked(updateWikiPage).mockResolvedValue(makePage({ title: 'Renamed' }))
  const { onSaved } = renderPage({ pageId: 'page-1' })
  const title = await screen.findByLabelText('Title')
  await waitFor(() => expect(title).toHaveValue("Grandma's lasagna"))
  expect(screen.getByLabelText('Category')).toHaveValue('Recipes')
  expect(screen.getByLabelText('Page content')).toHaveValue('Layer it well.')
  await userEvent.clear(title)
  await userEvent.type(title, 'Renamed')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('page-1'))
  expect(updateWikiPage).toHaveBeenCalledWith('page-1', {
    title: 'Renamed',
    emoji: '🍝',
    category: 'Recipes',
    content: 'Layer it well.',
    locked: false,
    baseUpdatedAt: '2026-07-02T10:00:00Z',
  })
})

it('shows the conflict box on a 409 and replaces the form with theirs', async () => {
  const theirs = makePage({
    title: 'Their title',
    content: 'Their content',
    updatedAt: '2026-07-03T10:00:00Z',
    updatedBy: { id: 'user-2', name: 'Sophie', avatarUrl: null },
  })
  vi.mocked(updateWikiPage).mockRejectedValueOnce(conflictError(theirs))
  const { onSaved } = renderPage({ pageId: 'page-1' })
  const content = await screen.findByLabelText('Page content')
  await waitFor(() => expect(content).toHaveValue('Layer it well.'))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Sophie saved this page while you were editing.')).toBeInTheDocument()
  expect(onSaved).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Discard mine, load theirs' }))
  expect(screen.getByLabelText('Page content')).toHaveValue('Their content')
  expect(screen.getByLabelText('Title')).toHaveValue('Their title')
  expect(screen.queryByText(/saved this page while you were editing/)).not.toBeInTheDocument()

  // The next save is based on their version.
  vi.mocked(updateWikiPage).mockResolvedValueOnce(theirs)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(updateWikiPage).toHaveBeenLastCalledWith(
    'page-1',
    expect.objectContaining({ content: 'Their content', baseUpdatedAt: '2026-07-03T10:00:00Z' })
  )
})

it('"Save mine anyway" resaves my content on top of their version', async () => {
  const theirs = makePage({ updatedAt: '2026-07-03T10:00:00Z' })
  vi.mocked(updateWikiPage).mockRejectedValueOnce(conflictError(theirs)).mockResolvedValueOnce(theirs)
  const { onSaved } = renderPage({ pageId: 'page-1' })
  const content = await screen.findByLabelText('Page content')
  await waitFor(() => expect(content).toHaveValue('Layer it well.'))
  await userEvent.type(content, ' Mine.')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Save mine anyway' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('page-1'))
  expect(updateWikiPage).toHaveBeenLastCalledWith(
    'page-1',
    expect.objectContaining({ content: 'Layer it well. Mine.', baseUpdatedAt: '2026-07-03T10:00:00Z' })
  )
})

it('shows the lock checkbox only to someone who can manage the page', async () => {
  const { unmount } = renderPage({ pageId: 'page-1' })
  expect(await screen.findByRole('checkbox', { name: /Lock page/ })).toBeInTheDocument()
  unmount()

  vi.mocked(fetchWikiPage).mockResolvedValue(makePage({ canManage: false }))
  renderPage({ pageId: 'page-1' })
  const title = await screen.findByLabelText('Title')
  await waitFor(() => expect(title).toHaveValue("Grandma's lasagna"))
  expect(screen.queryByRole('checkbox', { name: /Lock page/ })).not.toBeInTheDocument()
})

it('does not offer the form for a locked page the user cannot edit', async () => {
  vi.mocked(fetchWikiPage).mockResolvedValue(makePage({ canEdit: false, canManage: false, locked: true }))
  renderPage({ pageId: 'page-1' })
  expect(await screen.findByText(/Only the page's creator or an admin/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
})
