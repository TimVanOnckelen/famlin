import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api, fetchServerInfo } from '@famlin/api-client'
import { ReadOnlyBanner } from '../ReadOnlyBanner'
import { renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchServerInfo: vi.fn(),
}))

// Runs the rejection handlers the component registered, the way axios does
// for a failed response.
async function rejectWith(status: number, data: unknown) {
  const handlers = (api.interceptors.response as any).handlers.filter(Boolean)
  const error = Object.assign(new Error('fail'), { isAxiosError: true, response: { status, data } })
  for (const handler of handlers) {
    await act(async () => {
      await handler.rejected?.(error).catch(() => {})
    })
  }
}

beforeEach(() => vi.clearAllMocks())

it('renders nothing when the server is writable', async () => {
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null } as any)
  renderWithQueryClient(<ReadOnlyBanner />)
  await waitFor(() => expect(fetchServerInfo).toHaveBeenCalled())
  expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument()
})

it('explains a write the read-only demo blocked, and only that kind of failure', async () => {
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', readOnly: true, branding: null } as any)
  renderWithQueryClient(<ReadOnlyBanner />)
  expect(await screen.findByText(/Demo mode/)).toBeInTheDocument()

  await rejectWith(403, { error: 'Forbidden' })
  expect(screen.queryByText(/changes are disabled/)).not.toBeInTheDocument()

  await rejectWith(403, { error: 'read-only', code: 'READ_ONLY' })
  expect(await screen.findByText(/changes are disabled/)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByText(/changes are disabled/)).not.toBeInTheDocument()
})
