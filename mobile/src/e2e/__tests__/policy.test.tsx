import React from 'react'
import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { decideSend } from '../sendRule'
import { directMessagePolicyOf } from '@/hooks/useServerInfo'

const mockFetchServerInfo = jest.fn()
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchServerInfo: (...args: unknown[]) => mockFetchServerInfo(...args),
  getCurrentServerUrl: () => 'https://famlin.example.com',
}))

describe('server direct-message policy', () => {
  it('lets the administrator switch encryption off ahead of every other plaintext reason', () => {
    const ready = { status: 'ready' as const, peerIdentityCount: 1, encryptionDisabledAt: null }
    expect(decideSend({ ...ready, serverEncryptionDisabled: true })).toEqual({
      kind: 'plaintext',
      reason: 'serverDisabled',
    })
    for (const override of [
      { status: 'unsupported' as const },
      { status: 'loading' as const },
      { status: 'needsRestore' as const },
      { peerIdentityCount: 0 },
      { peerIdentityCount: undefined },
      { encryptionDisabledAt: '2026-01-01T00:00:00Z' },
    ]) {
      expect(decideSend({ ...ready, ...override, serverEncryptionDisabled: true })).toEqual({
        kind: 'plaintext',
        reason: 'serverDisabled',
      })
    }
    expect(decideSend({ ...ready, serverEncryptionDisabled: false })).toEqual({ kind: 'encrypt' })
  })

  it('reads the explicit policy', () => {
    const policy = (enabled: boolean, encryption: boolean) =>
      directMessagePolicyOf({ version: '1', directMessages: { enabled, web: true, encryption } })
    expect(policy(false, false)).toMatchObject({ disabledByAdmin: true, encryptionDisabledByAdmin: false })
    expect(policy(true, false)).toMatchObject({ disabledByAdmin: false, encryptionDisabledByAdmin: true })
    expect(policy(true, true)).toMatchObject({ disabledByAdmin: false, encryptionDisabledByAdmin: false })
  })

  it('falls back to the advertised features on a server without the field, never blaming an administrator', () => {
    expect(directMessagePolicyOf({ version: '0.10.0', features: ['directMessages'] })).toMatchObject({
      enabled: true,
      explicit: false,
      disabledByAdmin: false,
      encryptionDisabledByAdmin: false,
    })
    expect(directMessagePolicyOf({ version: '0.9.0', features: [] })).toMatchObject({
      enabled: false,
      disabledByAdmin: false,
    })
    expect(directMessagePolicyOf(undefined).disabledByAdmin).toBe(false)
  })

  describe('direct-message entry points', () => {
    const { useDirectMessagesSupport } = require('@/hooks/useServerInfo') as typeof import('@/hooks/useServerInfo')
    async function support(info: object) {
      mockFetchServerInfo.mockResolvedValue(info)
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      return await renderHook(() => useDirectMessagesSupport(), { wrapper })
    }

    it('are hidden once the administrator turned direct messages off, even if the feature is still listed', async () => {
      const { result } = await support({
        version: '1',
        features: ['directMessages'],
        directMessages: { enabled: false, web: true, encryption: false },
      })
      await waitFor(() => expect(result.current).toBe('unsupported'))
    })

    it('stay available when enabled, and follow the features on an older server', async () => {
      const on = await support({
        version: '1',
        features: ['directMessages'],
        directMessages: { enabled: true, web: true, encryption: true },
      })
      await waitFor(() => expect(on.result.current).toBe('supported'))
      const old = await support({ version: '0.10.0', features: ['directMessages'] })
      await waitFor(() => expect(old.result.current).toBe('supported'))
    })
  })
})
