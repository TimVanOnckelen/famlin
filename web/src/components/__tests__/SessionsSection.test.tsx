import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchSessions, revokeOtherSessions, revokeSession } from '@famlin/api-client'
import { SessionsSection } from '../SessionsSection'
import { renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}))

const now = new Date().toISOString()
const sessions = [
  {
    id: 'current',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/133.0',
    createdAt: now,
    lastUsedAt: now,
    current: true,
  },
  { id: 'phone', userAgent: 'okhttp/4.12.0', createdAt: now, lastUsedAt: now, current: false },
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchSessions).mockResolvedValue({ items: sessions, currentListed: true })
  vi.mocked(revokeSession).mockResolvedValue()
  vi.mocked(revokeOtherSessions).mockResolvedValue({ revoked: 1 })
})

it('lists devices, marks this one and offers sign-out only for the others', async () => {
  renderWithQueryClient(<SessionsSection />)
  expect(await screen.findByText('Firefox on macOS')).toBeInTheDocument()
  expect(screen.getByText('This device')).toBeInTheDocument()
  expect(screen.getByText('Famlin app Android')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Sign out (?!all)/ })).toHaveLength(1)
})

it('signs out one other device', async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<SessionsSection />)
  await user.click(await screen.findByRole('button', { name: 'Sign out Famlin app Android' }))
  await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('phone', expect.anything()))
})

it('signs out every other device after confirming', async () => {
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderWithQueryClient(<SessionsSection />)
  await user.click(await screen.findByRole('button', { name: 'Sign out all other devices' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Signed out 1 other device.')
})
