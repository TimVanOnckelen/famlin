import { StrictMode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router'
import { completeBrowserOidcLogin, clearBrowserOidcLogin, fetchOidcConfig } from '@famlin/api-client'
import { LoginPage } from '../LoginPage'
import { useAuthStore } from '@/stores/authStore'
import { rememberReturnPath, takeReturnPath } from '@/utils/routes'
import { makeUser, renderWithQueryClient, createTestQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchOidcConfig: vi.fn(),
  completeBrowserOidcLogin: vi.fn(),
  clearBrowserOidcLogin: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ branding: null }),
}))
const session = { user: makeUser(), token: 'session-token' }
const authenticate = vi.fn().mockResolvedValue(undefined)
function Location() {
  const location = useLocation()
  return (
    <output aria-label="Current path">
      {location.pathname}
      {location.search}
    </output>
  )
}
function renderPage(strict = false) {
  const client = createTestQueryClient()
  client.setQueryData(['groups'], [])
  const content = (
    <>
      <LoginPage />
      <Location />
    </>
  )
  return renderWithQueryClient(strict ? <StrictMode>{content}</StrictMode> : content, { queryClient: client })
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/?code=auth-code&state=valid-state')
  useAuthStore.setState({ setAuth: authenticate })
  vi.mocked(fetchOidcConfig).mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof fetchOidcConfig>>)
  vi.mocked(completeBrowserOidcLogin).mockReset().mockResolvedValue(session)
})
afterEach(() => window.history.replaceState({}, '', '/'))

it('restores the invitation token after an OIDC round trip and completes login only once in StrictMode', async () => {
  rememberReturnPath('/join/invite-1')
  const { queryClient } = renderPage(true)
  await waitFor(() => expect(authenticate).toHaveBeenCalledWith(session.user, session.token))
  expect(completeBrowserOidcLogin).toHaveBeenCalledTimes(1)
  expect(completeBrowserOidcLogin).toHaveBeenCalledWith(
    'auth-code',
    'valid-state',
    `${window.location.origin}/`,
    'invite-1'
  )
  expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/$/)
  expect(queryClient.getQueryData(['groups'])).toBeUndefined()
  expect(takeReturnPath()).toBeNull()
})
it('returns a failed exchange to the invitation with an actionable error state', async () => {
  rememberReturnPath('/join/invite-1')
  vi.mocked(completeBrowserOidcLogin).mockRejectedValue(new Error('oidc_state_mismatch'))
  renderPage()
  await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent('/join/invite-1?loginError=1'))
  expect(authenticate).not.toHaveBeenCalled()
  expect(takeReturnPath()).toBeNull()
})
it('returns provider cancellation to the invitation and clears the unfinished flow', async () => {
  rememberReturnPath('/join/invite-1')
  window.history.replaceState({}, '', '/?error=access_denied')
  renderPage()
  await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent('/join/invite-1?loginError=1'))
  expect(clearBrowserOidcLogin).toHaveBeenCalled()
  expect(completeBrowserOidcLogin).not.toHaveBeenCalled()
  expect(authenticate).not.toHaveBeenCalled()
})
it('preserves ordinary SSO deep-link behavior without an invitation', async () => {
  rememberReturnPath('/posts/shared-post')
  renderPage()
  await waitFor(() => expect(authenticate).toHaveBeenCalled())
  expect(completeBrowserOidcLogin).toHaveBeenCalledWith(
    'auth-code',
    'valid-state',
    `${window.location.origin}/`,
    undefined
  )
  expect(screen.getByLabelText('Current path')).toHaveTextContent('/posts/shared-post')
})
