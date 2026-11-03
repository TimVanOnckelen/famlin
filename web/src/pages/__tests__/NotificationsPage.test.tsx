import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchNotifications, fetchStory, markNotificationRead, markAllNotificationsRead } from '@famlin/api-client'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchStory: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  fetchGroups: vi.fn().mockResolvedValue([{ id: 'group-1' }]),
  fetchChatUnreadCounts: vi.fn().mockResolvedValue({}),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(1),
  fetchServerInfo: vi.fn().mockResolvedValue({ branding: null }),
}))
vi.mock('@/components/StoryViewer', () => ({ StoryViewer: () => <div>story viewer</div> }))
const item = {
  id: 'n-1',
  type: 'new_post',
  message: 'A new family post',
  relatedPostId: 'post-1',
  createdAt: '2026-10-01T12:00:00Z',
  readAt: null,
}
function renderPage() {
  const onOpenPost = vi.fn()
  renderWithQueryClient(
    <NotificationsPage
      user={makeUser()}
      onOpenFeed={vi.fn()}
      onOpenPhotos={vi.fn()}
      onOpenChat={vi.fn()}
      onOpenFavorites={vi.fn()}
      onOpenProfile={vi.fn()}
      onOpenPost={onOpenPost}
      onLogout={vi.fn()}
    />
  )
  return { onOpenPost }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchNotifications).mockReset()
  vi.mocked(fetchNotifications).mockResolvedValue([item])
  vi.mocked(markNotificationRead).mockResolvedValue(undefined)
  vi.mocked(markAllNotificationsRead).mockResolvedValue(undefined)
})
it('opens a related post and marks an unread entry as read', async () => {
  const { onOpenPost } = renderPage()
  await userEvent.click(await screen.findByText(item.message))
  expect(onOpenPost).toHaveBeenCalledWith('post-1')
  await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n-1', expect.anything()))
})
it('marks all notifications as read and refreshes the list', async () => {
  renderPage()
  await screen.findByText(item.message)
  await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled())
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2))
})
it('shows an empty state', async () => {
  vi.mocked(fetchNotifications).mockResolvedValue([])
  renderPage()
  expect(await screen.findByText('No notifications')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
})
it('retries a failed load', async () => {
  vi.mocked(fetchNotifications).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([item])
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  expect(await screen.findByText(item.message)).toBeInTheDocument()
})
it('does not mark a read notification again', async () => {
  vi.mocked(fetchNotifications).mockResolvedValue([{ ...item, readAt: item.createdAt }])
  renderPage()
  await userEvent.click(await screen.findByText(item.message))
  expect(markNotificationRead).not.toHaveBeenCalled()
})

it('opens a related story', async () => {
  vi.mocked(fetchNotifications).mockResolvedValue([{ ...item, relatedPostId: null, relatedStoryId: 'story-1' }])
  vi.mocked(fetchStory).mockResolvedValue({ id: 'story-1' } as Awaited<ReturnType<typeof fetchStory>>)
  renderPage()
  await userEvent.click(await screen.findByText(item.message))
  expect(await screen.findByText('story viewer')).toBeInTheDocument()
  expect(fetchStory).toHaveBeenCalledWith('story-1')
})
it('reports a failed mark-all request', async () => {
  vi.mocked(markAllNotificationsRead).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  await screen.findByText(item.message)
  await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not mark notifications as read')
})
