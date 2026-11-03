import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  fetchInvitePreview,
  fetchOidcConfig,
  registerViaInvite,
  loginWithPassword,
  acceptInvite,
  type InvitePreview,
  type User,
} from '@famlin/api-client'
import { JoinPage } from '../JoinPage'
import { makeUser, renderWithQueryClient, createTestQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchInvitePreview: vi.fn(),
  fetchOidcConfig: vi.fn(),
  registerViaInvite: vi.fn(),
  loginWithPassword: vi.fn(),
  acceptInvite: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ branding: null }),
}))
const preview: InvitePreview = {
  status: 'valid',
  groupName: 'Test family',
  groupDescription: 'A family description',
  inviterName: 'Anna',
  email: null,
}
const result = { user: makeUser(), token: 'auth-token' }
function renderPage(user: User | null = null, loginFailed = false) {
  const client = createTestQueryClient()
  client.setQueryData(['groups'], [])
  const props = {
    token: 'invite-token',
    user,
    loginFailed,
    onAuthenticated: vi.fn().mockResolvedValue(undefined),
    onJoined: vi.fn(),
    onStartSso: vi.fn().mockResolvedValue(undefined),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  }
  return { ...renderWithQueryClient(<JoinPage {...props} />, { queryClient: client }), ...props }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchInvitePreview).mockReset().mockResolvedValue(preview)
  vi.mocked(fetchOidcConfig).mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof fetchOidcConfig>>)
  vi.mocked(registerViaInvite).mockReset().mockResolvedValue(result)
  vi.mocked(loginWithPassword).mockReset().mockResolvedValue(result)
  vi.mocked(acceptInvite).mockReset().mockResolvedValue({ success: true, groupId: 'family-1' })
})
it('previews the family and inviter without requiring a session', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Test family' })).toBeInTheDocument()
  expect(screen.getByText('Invited by Anna')).toBeInTheDocument()
  expect(screen.getByText(preview.groupDescription!)).toBeInTheDocument()
  expect(fetchInvitePreview).toHaveBeenCalledWith('invite-token')
  expect(acceptInvite).not.toHaveBeenCalled()
})
it('shows loading while the preview is pending', async () => {
  let finish!: (preview: InvitePreview) => void
  vi.mocked(fetchInvitePreview).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  renderPage()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await act(async () => finish(preview))
  expect(await screen.findByRole('heading', { name: 'Test family' })).toBeInTheDocument()
})
it.each(['expired', 'used', 'not_found'] as const)(
  'shows the %s state without offering acceptance or registration',
  async (status) => {
    vi.mocked(fetchInvitePreview).mockResolvedValue({ ...preview, status })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/invitation/i)
    expect(screen.queryByRole('button', { name: 'Create account and join' })).not.toBeInTheDocument()
    expect(acceptInvite).not.toHaveBeenCalled()
    expect(registerViaInvite).not.toHaveBeenCalled()
  }
)
it('distinguishes a connection failure from an invalid invitation and retries', async () => {
  vi.mocked(fetchInvitePreview).mockRejectedValueOnce(new Error('offline'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this invitation')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'Test family' })).toBeInTheDocument()
})
it('registers with the invitation and passes the session to the caller without accepting twice', async () => {
  const { onAuthenticated } = renderPage()
  await userEvent.type(await screen.findByLabelText('Your name'), ' New member ')
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'password123')
  await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
  await waitFor(() =>
    expect(registerViaInvite).toHaveBeenCalledWith('invite-token', {
      name: 'New member',
      email: 'new@example.com',
      password: 'password123',
    })
  )
  expect(onAuthenticated).toHaveBeenCalledWith(result)
  expect(acceptInvite).not.toHaveBeenCalled()
})
it('prefills an email-restricted invitation and prevents editing the invited address', async () => {
  vi.mocked(fetchInvitePreview).mockResolvedValue({ ...preview, email: 'invited@example.com' })
  renderPage()
  const email = await screen.findByLabelText('Email')
  expect(email).toHaveValue('invited@example.com')
  expect(email).toHaveAttribute('readonly')
})
it('passes inviteToken during password sign-in', async () => {
  const { onAuthenticated } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  await userEvent.type(screen.getByLabelText('Email'), 'existing@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'old-password')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in and join' }))
  await waitFor(() =>
    expect(loginWithPassword).toHaveBeenCalledWith('existing@example.com', 'old-password', 'invite-token')
  )
  expect(onAuthenticated).toHaveBeenCalledWith(result)
  expect(acceptInvite).not.toHaveBeenCalled()
})
it('lets a signed-in user explicitly accept and refreshes cached family membership', async () => {
  const { onJoined, queryClient } = renderPage(makeUser())
  await userEvent.click(await screen.findByRole('button', { name: 'Join Test family' }))
  await waitFor(() => expect(onJoined).toHaveBeenCalledWith('family-1'))
  expect(acceptInvite).toHaveBeenCalledWith('invite-token')
  expect(queryClient.getQueryState(['groups'])?.isInvalidated).toBe(true)
})
it('blocks an email mismatch and offers account switching', async () => {
  vi.mocked(fetchInvitePreview).mockResolvedValue({ ...preview, email: 'other@example.com' })
  const { onSignOut } = renderPage(makeUser({ email: 'member@example.com' }))
  expect(await screen.findByRole('button', { name: 'Join Test family' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('other@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Sign out and use another account' }))
  expect(onSignOut).toHaveBeenCalled()
  expect(acceptInvite).not.toHaveBeenCalled()
})
it('shows server rejection and permits retrying acceptance', async () => {
  vi.mocked(acceptInvite).mockRejectedValueOnce({
    isAxiosError: true,
    response: { data: { error: 'Invitation expired during acceptance' } },
  })
  const { onJoined } = renderPage(makeUser())
  await userEvent.click(await screen.findByRole('button', { name: 'Join Test family' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Invitation expired during acceptance')
  expect(onJoined).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Join Test family' }))
  await waitFor(() => expect(onJoined).toHaveBeenCalledWith('family-1'))
})
it('offers configured SSO through the callback and reports a returned SSO failure', async () => {
  const config = {
    enabled: true,
    name: 'Family SSO',
    authorizationEndpoint: 'https://sso.example/auth',
    tokenEndpoint: 'https://sso.example/token',
    clientId: 'web',
    scopes: 'openid',
    usesClientSecret: false,
  }
  vi.mocked(fetchOidcConfig).mockResolvedValue(config)
  const { onStartSso } = renderPage(null, true)
  await userEvent.click(await screen.findByRole('button', { name: /Family SSO/ }))
  expect(onStartSso).toHaveBeenCalledWith(config)
})
it('shows the error returned from a failed SSO round trip', async () => {
  renderPage(null, true)
  expect(await screen.findByRole('alert')).toHaveTextContent(/SSO|sign.?in|log.?in/i)
})
