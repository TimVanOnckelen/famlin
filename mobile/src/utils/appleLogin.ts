import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'

import { LoginResponse, getCurrentServerUrl, loginWithApple } from '@/api/auth'

export class AppleCancelledError extends Error {}

// Apple only hands over the user's name in the response of their very first
// authorization for this app; every later sign-in returns nulls there, and the
// identity token itself never carries a name. So it's sent to the server only
// when present, and the server keeps the stored name otherwise.
function formatFullName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string | undefined {
  if (!fullName) return undefined
  const parts = [fullName.givenName, fullName.familyName].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

// Sign in with Apple is iOS-only (the native sheet doesn't exist elsewhere)
// and needs the device to actually support it — isAvailableAsync is false on
// iOS simulators/versions without it, in which case the button is hidden.
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false
  try {
    return await AppleAuthentication.isAvailableAsync()
  } catch {
    return false
  }
}

// Whether this device can show the Apple sheet at all. Callers need it for
// more than the button itself — the login screen also uses it to decide
// whether an "or" divider above the alternative logins has anything under it.
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    isAppleSignInAvailable().then((result) => {
      if (!cancelled) setAvailable(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}

// The host part of the server URL ("host[:port]", lowercase, default port
// dropped) — the same normalization as normalizeAppleNonceHost on the server.
// Parsed by hand: React Native's URL polyfill doesn't implement `host`.
export function appleNonceHost(serverUrl: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i.exec(serverUrl.trim())
  return match ? match[1].toLowerCase().replace(/:(80|443)$/, '') : null
}

// Binds the identity token to the server this app is signing in to. Every
// Famlin server accepts tokens for this same app, so without the binding any
// server the user signs in to could replay their token on another one. Apple
// copies the requested nonce into the token unchanged; the server recomputes
// it from rawNonce and its own host (appleNonceFor in the backend's
// services/appleLogin.ts — keep the format in lockstep).
export async function appleNonceFor(host: string, rawNonce: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `famlin-apple-signin|${host}|${rawNonce}`)
}

export async function performAppleLogin(inviteToken?: string): Promise<LoginResponse> {
  const serverUrl = getCurrentServerUrl()
  const host = serverUrl ? appleNonceHost(serverUrl) : null
  if (!host) throw new Error('No server selected for Sign in with Apple')
  const rawNonce = Array.from(await Crypto.getRandomBytesAsync(16), (b) => b.toString(16).padStart(2, '0')).join('')
  const nonce = await appleNonceFor(host, rawNonce)

  let credential: AppleAuthentication.AppleAuthenticationCredential
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    })
  } catch (err: any) {
    // Dismissing the native sheet isn't a failure worth alerting about.
    if (err?.code === 'ERR_REQUEST_CANCELED') throw new AppleCancelledError()
    throw err
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token')
  }

  return loginWithApple(credential.identityToken, formatFullName(credential.fullName), inviteToken, rawNonce)
}
