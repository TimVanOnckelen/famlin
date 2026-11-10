import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchOidcConfig, fetchServerInfo } from '@famlin/api-client'
import { LoginPage } from '../LoginPage'
import { renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchOidcConfig: vi.fn(),
  fetchServerInfo: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchOidcConfig).mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof fetchOidcConfig>>)
})

it('shows the demo notice and fills in the demo login on a read-only server', async () => {
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', readOnly: true, branding: null } as any)
  renderWithQueryClient(<LoginPage />)

  expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fill in demo login' }))
  expect(screen.getByLabelText('Email')).toHaveValue('test@example.com')
  expect(screen.getByLabelText('Password')).toHaveValue('test123456')
})

it('shows no demo notice on a normal server', async () => {
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null } as any)
  renderWithQueryClient(<LoginPage />)
  await screen.findByRole('button', { name: 'Log in' })
  expect(screen.queryByRole('heading', { name: 'Demo' })).not.toBeInTheDocument()
})
