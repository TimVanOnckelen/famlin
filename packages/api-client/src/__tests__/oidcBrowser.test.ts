import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { completeBrowserOidcLogin } from '../oidcBrowser'
import { exchangeOidcCode, loginWithOidc } from '../auth'
vi.mock('../auth', () => ({ exchangeOidcCode: vi.fn(), loginWithOidc: vi.fn() }))
let storage: Map<string, string>
beforeEach(() => {
  vi.clearAllMocks()
  storage = new Map([
    ['famlin_oidc_state', 'state'],
    ['famlin_oidc_verifier', 'verifier'],
    [
      'famlin_oidc_config',
      JSON.stringify({ usesClientSecret: false, tokenEndpoint: 'https://sso.example/token', clientId: 'web' }),
    ],
  ])
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id_token: 'id-token' }) }))
})
afterEach(() => vi.unstubAllGlobals())
it('forwards the invitation with a direct OIDC token login and clears PKCE state', async () => {
  await completeBrowserOidcLogin('code', 'state', 'https://famlin.example/', 'invite-1')
  expect(loginWithOidc).toHaveBeenCalledWith('id-token', 'invite-1')
  expect(storage.size).toBe(0)
})
it('forwards the invitation for a server-mediated code exchange', async () => {
  storage.set('famlin_oidc_config', JSON.stringify({ usesClientSecret: true }))
  await completeBrowserOidcLogin('code', 'state', 'https://famlin.example/', 'invite-1')
  expect(exchangeOidcCode).toHaveBeenCalledWith('code', 'https://famlin.example/', 'verifier', 'invite-1')
  expect(loginWithOidc).not.toHaveBeenCalled()
  expect(storage.size).toBe(0)
})
it('validates state before either login path and clears state on failure', async () => {
  await expect(completeBrowserOidcLogin('code', 'wrong-state', 'https://famlin.example/', 'invite-1')).rejects.toThrow(
    'oidc_state_mismatch'
  )
  expect(exchangeOidcCode).not.toHaveBeenCalled()
  expect(loginWithOidc).not.toHaveBeenCalled()
  expect(storage.size).toBe(0)
})
it('continues to support normal SSO without an invitation', async () => {
  await completeBrowserOidcLogin('code', 'state', 'https://famlin.example/')
  expect(loginWithOidc).toHaveBeenCalledWith('id-token', undefined)
})
