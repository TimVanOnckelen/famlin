jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
    require('crypto').createHash('sha256').update(data).digest('hex')
  ),
  randomUUID: jest.fn(() => '11111111-2222-4333-8444-555555555555'),
}))

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(async () => ({ identityToken: 'apple-id-token', fullName: null })),
  isAvailableAsync: jest.fn(async () => true),
}))

jest.mock('@/api/auth', () => ({
  getCurrentServerUrl: jest.fn(() => 'https://Family.Example.com:8443/'),
  loginWithApple: jest.fn(async () => ({ token: 't', user: {} })),
}))

import * as AppleAuthentication from 'expo-apple-authentication'
import { loginWithApple } from '@/api/auth'
import { appleNonceHost, performAppleLogin } from '../appleLogin'

describe('appleNonceHost', () => {
  it('returns the lowercase host[:port] of the server URL', () => {
    expect(appleNonceHost('https://Family.Example.com')).toBe('family.example.com')
    expect(appleNonceHost('http://192.168.1.10:3000/sub/path')).toBe('192.168.1.10:3000')
    expect(appleNonceHost('not a url')).toBeNull()
  })
})

describe('performAppleLogin', () => {
  it('binds the identity token to the current server via the nonce', async () => {
    await performAppleLogin('invite-1')

    const rawNonce = '11111111-2222-4333-8444-555555555555'
    const nonceHost = 'family.example.com:8443'
    // sha256hex(`famlin-apple-signin|${nonceHost}|${rawNonce}`) — the value
    // appleNonceFor() in the backend's services/appleLogin.ts computes.
    const expectedNonce = '2d0db889fd565890550f40057efb11046b440e2f5a2f7b9e3d40fd5a9f26cd4e'

    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: expectedNonce }))
    expect(loginWithApple).toHaveBeenCalledWith('apple-id-token', undefined, 'invite-1', { rawNonce, nonceHost })
  })
})
