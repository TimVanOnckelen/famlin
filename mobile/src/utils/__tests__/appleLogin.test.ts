jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
    require('crypto').createHash('sha256').update(data).digest('hex')
  ),
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(171)),
}))

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(async () => ({ identityToken: 'apple-id-token', fullName: null })),
  isAvailableAsync: jest.fn(async () => true),
}))

jest.mock('@/api/auth', () => ({
  getCurrentServerUrl: jest.fn(() => 'https://Family.Example.com:443/'),
  loginWithApple: jest.fn(async () => ({ token: 't', user: {} })),
}))

import * as AppleAuthentication from 'expo-apple-authentication'
import { loginWithApple } from '@/api/auth'
import { appleNonceHost, performAppleLogin } from '../appleLogin'

describe('appleNonceHost', () => {
  it('normalizes to lowercase host[:port] without a default port', () => {
    expect(appleNonceHost('https://Family.Example.com')).toBe('family.example.com')
    expect(appleNonceHost('https://family.example.com:443/sub/path')).toBe('family.example.com')
    expect(appleNonceHost('http://192.168.1.10:3000')).toBe('192.168.1.10:3000')
    expect(appleNonceHost('http://user:pw@nas.local:80')).toBe('nas.local')
    expect(appleNonceHost('not a url')).toBeNull()
  })
})

describe('performAppleLogin', () => {
  it('binds the identity token to the current server via the nonce', async () => {
    await performAppleLogin('invite-1')

    const rawNonce = 'ab'.repeat(16)
    // sha256hex("famlin-apple-signin|family.example.com|" + rawNonce) — the
    // value appleNonceFor() in the backend's services/appleLogin.ts computes.
    const expectedNonce = 'b2ffb28b93805b161e2dbc599164fad50a261dd034fc547713d1ed261b4d29e2'

    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: expectedNonce }))
    expect(loginWithApple).toHaveBeenCalledWith('apple-id-token', undefined, 'invite-1', rawNonce)
  })
})
