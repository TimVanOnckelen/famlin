import { useLocation } from 'react-router'
import { useAppNavigation } from '@/utils/routes'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchGroups, fetchGroupMembers, fetchMyCircles, fetchCircleMembers, type Group } from '@famlin/api-client'
import { MembersPage } from '../MembersPage'
import { makeUser, renderWithQueryClient, createTestQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchGroupMembers: vi.fn(),
  fetchMyCircles: vi.fn(),
  fetchCircleMembers: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ branding: null }),
  fetchChatUnreadCounts: vi.fn().mockResolvedValue({}),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
}))
const groups: Group[] = [
  {
    id: 'family-a',
    name: 'First family',
    description: 'First family description',
    createdAt: '2026-01-01',
    chitchatEnabled: true,
  },
  { id: 'family-b', name: 'Second family', createdAt: '2026-01-01', chitchatEnabled: false },
]
const circle = {
  id: 'circle-a',
  groupId: 'family-a',
  name: 'Weekend plans',
  description: 'A private circle description',
  memberCount: 1,
  createdAt: '2026-01-01',
}
const anna = {
  id: 'anna',
  name: 'Anna',
  email: 'anna@example.com',
  avatarUrl: 'https://example.com/anna.jpg',
  joinedAt: '2026-01-01',
  isAdmin: true,
}
const bob = { id: 'bob', name: 'Bob', email: 'bob@example.com', avatarUrl: null, joinedAt: '2026-01-01' }
const clara = { id: 'clara', name: 'Clara', avatarUrl: null, joinedAt: '2026-01-01' }
function renderPage(groupId?: string, client = createTestQueryClient()) {
  const onOpenFeed = vi.fn()
  const result = renderWithQueryClient(
    <MembersPage
      user={makeUser()}
      groupId={groupId}
      onOpenFeed={onOpenFeed}
      onOpenProfile={vi.fn()}
      onLogout={vi.fn()}
    />,
    { queryClient: client }
  )
  return { ...result, onOpenFeed }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockReset().mockResolvedValue(groups)
  vi.mocked(fetchGroupMembers)
    .mockReset()
    .mockImplementation(async (id) => (id === 'family-a' ? [anna] : [bob]))
  vi.mocked(fetchMyCircles)
    .mockReset()
    .mockImplementation(async (id) => (id === 'family-a' ? [circle] : []))
  vi.mocked(fetchCircleMembers).mockReset().mockResolvedValue([clara])
})

it('lists every family, member avatars, available admin flags, and the caller’s circles', async () => {
  renderPage()
  const first = await screen.findByRole('region', { name: 'First family' })
  const second = await screen.findByRole('region', { name: 'Second family' })
  expect(await within(first).findByText('Anna')).toBeInTheDocument()
  expect(within(first).getByRole('img', { name: 'Anna' })).toHaveAttribute('src', anna.avatarUrl)
  expect(within(first).getByText('Admin')).toBeInTheDocument()
  expect(await within(second).findByText('Bob')).toBeInTheDocument()
  expect(within(second).queryByText('Anna')).not.toBeInTheDocument()
  const privateCircle = await within(first).findByRole('region', { name: circle.name })
  expect(within(privateCircle).getByText(circle.description)).toBeInTheDocument()
  expect(await within(privateCircle).findByText('Clara')).toBeInTheDocument()
  expect(await within(second).findByText('You are not in any circles in this family.')).toBeInTheDocument()
  expect(fetchMyCircles).toHaveBeenCalledWith('family-a')
  expect(fetchMyCircles).toHaveBeenCalledWith('family-b')
  expect(fetchCircleMembers).toHaveBeenCalledTimes(1)
  expect(fetchCircleMembers).toHaveBeenCalledWith('circle-a')
})

it('does not expose cached circles outside the caller’s returned families and circles', async () => {
  const client = createTestQueryClient()
  client.setQueryData(['circles', 'hidden-family'], [{ ...circle, id: 'hidden-circle', name: 'Secret circle' }])
  client.setQueryData(['circle-members', 'hidden-circle'], [{ ...clara, name: 'Hidden member' }])
  renderPage('hidden-family', client)
  await screen.findByText('Clara')
  expect(screen.queryByText('Secret circle')).not.toBeInTheDocument()
  expect(screen.queryByText('Hidden member')).not.toBeInTheDocument()
  expect(fetchGroupMembers).not.toHaveBeenCalledWith('hidden-family')
  expect(fetchMyCircles).not.toHaveBeenCalledWith('hidden-family')
  expect(fetchCircleMembers).not.toHaveBeenCalledWith('hidden-circle')
})

it('highlights a requested family while retaining all families', async () => {
  renderPage('family-b')
  expect(await screen.findByRole('region', { name: 'Second family' })).toHaveClass('members-family-highlighted')
  expect(screen.getByRole('region', { name: 'First family' })).not.toHaveClass('members-family-highlighted')
})

it('shows loading before the list arrives', async () => {
  let resolve!: (groups: Group[]) => void
  vi.mocked(fetchGroups).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  renderPage()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(fetchGroupMembers).not.toHaveBeenCalled()
  await act(async () => resolve(groups))
  expect(await screen.findByText('Anna')).toBeInTheDocument()
})

it('handles a user without families without requesting any members or circles', async () => {
  vi.mocked(fetchGroups).mockResolvedValue([])
  renderPage()
  expect(await screen.findByText(/You are not part of any family yet/)).toBeInTheDocument()
  expect(fetchGroupMembers).not.toHaveBeenCalled()
  expect(fetchMyCircles).not.toHaveBeenCalled()
  expect(fetchCircleMembers).not.toHaveBeenCalled()
})

it('retries a failed family list', async () => {
  vi.mocked(fetchGroups).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not load your families.')
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Anna')).toBeInTheDocument()
})

it('retries one failed member list while keeping other families and circles visible', async () => {
  vi.mocked(fetchGroupMembers).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  const first = await screen.findByRole('region', { name: 'First family' })
  const alert = await within(first).findByRole('alert')
  expect(alert).toHaveTextContent('Could not load this family’s members.')
  expect(await screen.findByText('Bob')).toBeInTheDocument()
  expect(await screen.findByText('Clara')).toBeInTheDocument()
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
  expect(await within(first).findByText('Anna')).toBeInTheDocument()
})

it('keeps family members visible when the circle list fails and retries only that list', async () => {
  vi.mocked(fetchMyCircles).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  const first = await screen.findByRole('region', { name: 'First family' })
  const alert = await within(first).findByRole('alert')
  expect(alert).toHaveTextContent('Could not load your circles in this family.')
  expect(await within(first).findByText('Anna')).toBeInTheDocument()
  expect(fetchCircleMembers).not.toHaveBeenCalled()
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Clara')).toBeInTheDocument()
  expect(fetchGroupMembers).toHaveBeenCalledTimes(2)
})

it('handles and retries a circle member failure without replacing the family list', async () => {
  vi.mocked(fetchCircleMembers).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  const privateCircle = await screen.findByRole('region', { name: circle.name })
  const alert = await within(privateCircle).findByRole('alert')
  expect(alert).toHaveTextContent('Could not load this circle’s members.')
  expect(screen.getByText('Anna')).toBeInTheDocument()
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
  expect(await within(privateCircle).findByText('Clara')).toBeInTheDocument()
})

it('renders empty member lists without crashing', async () => {
  vi.mocked(fetchGroupMembers).mockResolvedValue([])
  vi.mocked(fetchCircleMembers).mockResolvedValue([])
  renderPage()
  await waitFor(() => expect(screen.getAllByText('No members to show.')).toHaveLength(3))
})

it('uses the supplied back callback', async () => {
  const { onOpenFeed } = renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(onOpenFeed).toHaveBeenCalledTimes(1)
})

function MembersNavigationHarness() {
  const nav = useAppNavigation()
  const location = useLocation()
  return (
    <>
      <button onClick={() => nav.toMembers('family /&?')}>open family members</button>
      <button onClick={() => nav.toMembers()}>open all members</button>
      <output aria-label="Current location">
        {location.pathname}
        {location.search}
      </output>
    </>
  )
}

it('navigates to members with a safely encoded optional family and clears the query for all families', async () => {
  renderWithQueryClient(<MembersNavigationHarness />)
  await userEvent.click(screen.getByRole('button', { name: 'open family members' }))
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/members?groupId=family+%2F%26%3F')
  await userEvent.click(screen.getByRole('button', { name: 'open all members' }))
  expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/members$/)
})
