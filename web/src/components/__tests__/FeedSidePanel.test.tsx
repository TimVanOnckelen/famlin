import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchGroupMembers, fetchOnThisDay } from '@famlin/api-client'
import { renderWithQueryClient } from '@/test/fixtures'
import { FeedSidePanel } from '../FeedSidePanel'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchGroupMembers: vi.fn(),
  fetchOnThisDay: vi.fn(),
}))
const groups = [
  { id: 'one', name: 'Family', description: 'Family updates', createdAt: '2026-01-01', chitchatEnabled: false },
  { id: 'two', name: 'Relatives', description: 'Our wider family', createdAt: '2026-01-01', chitchatEnabled: false },
]
const anna = { id: 'anna', name: 'Anna', email: 'anna@example.com', joinedAt: '2026-01-01' }
const olga = { id: 'olga', name: 'Olga', email: 'olga@example.com', joinedAt: '2026-01-01' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchOnThisDay).mockResolvedValue([])
  vi.mocked(fetchGroupMembers).mockImplementation(async (id) => (id === 'one' ? [anna] : [anna, olga]))
})

const actions = { onOpenPost: vi.fn(), onToggleGroup: vi.fn(), onSelectAllGroups: vi.fn() }

it('combines selected groups, deduplicates members and labels their groups without member controls', async () => {
  renderWithQueryClient(<FeedSidePanel groups={groups} selectedGroupIds={[]} {...actions} />)
  expect(await screen.findByText('Olga')).toBeInTheDocument()
  expect(screen.getAllByText('Anna')).toHaveLength(1)
  expect(within(screen.getByText('Anna').closest('li')!).getByText('Family · Relatives')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(fetchOnThisDay).not.toHaveBeenCalled()
})

it('shows each group with its description above members and supports feed selection', async () => {
  renderWithQueryClient(<FeedSidePanel groups={groups} selectedGroupIds={['one']} {...actions} />)
  expect(await screen.findByText('Anna')).toBeInTheDocument()
  expect(screen.queryByText('Olga')).not.toBeInTheDocument()
  const relatives = screen.getByRole('button', { name: 'Relatives' })
  expect(relatives).toHaveAccessibleDescription('Our wider family')
  expect(screen.getByRole('button', { name: 'Family' })).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.getByText('Our wider family').compareDocumentPosition(screen.getByText('Anna')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  await userEvent.click(relatives)
  expect(actions.onToggleGroup).toHaveBeenCalledWith('two')
  await userEvent.click(screen.getByRole('button', { name: 'All families' }))
  expect(actions.onSelectAllGroups).toHaveBeenCalled()
})

it('shows members directly without a group filter for a single membership', async () => {
  renderWithQueryClient(<FeedSidePanel groups={[groups[0]]} selectedGroupIds={[]} {...actions} />)
  expect(await screen.findByText('Anna')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Family' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'All families' })).not.toBeInTheDocument()
  expect(screen.getByRole('complementary').firstElementChild).toHaveClass('side-panel-members-card')
})

it('keeps the card visible while loading and reports partial failures with retry', async () => {
  vi.mocked(fetchGroupMembers).mockImplementation(async (id) => {
    if (id === 'two') throw new Error('offline')
    return [anna]
  })
  renderWithQueryClient(<FeedSidePanel groups={groups} selectedGroupIds={[]} {...actions} />)
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(await screen.findByRole('alert')).toHaveTextContent('Some members could not be loaded.')
  expect(screen.getByText('Anna')).toBeInTheDocument()
  vi.mocked(fetchGroupMembers).mockResolvedValue([olga])
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Olga')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})
