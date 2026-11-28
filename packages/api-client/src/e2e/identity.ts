import { canonical, toBase64, bytesEqual } from './encoding'
import {
  boxPublicKey,
  decodeKey,
  generateBoxKeyPair,
  generateSigningKeyPair,
  sha512,
  signingPublicKey,
} from './primitives'
import { E2eError, type E2eIdentityKeys, type E2ePublicIdentity } from './types'

/** A fresh identity for `userId`; `version` is 1 for a first identity, previous + 1 on a reset. */
export function generateIdentity(userId: string, version: number): E2eIdentityKeys {
  const signing = generateSigningKeyPair()
  const box = generateBoxKeyPair()
  return {
    userId,
    version,
    signPublicKey: toBase64(signing.publicKey),
    boxPublicKey: toBase64(box.publicKey),
    signPrivateKey: toBase64(signing.privateKey),
    boxPrivateKey: toBase64(box.privateKey),
  }
}

export function publicIdentity(keys: E2eIdentityKeys): E2ePublicIdentity {
  return {
    userId: keys.userId,
    version: keys.version,
    signPublicKey: keys.signPublicKey,
    boxPublicKey: keys.boxPublicKey,
  }
}

/**
 * Checks private keys really belong to a published identity: their derived
 * public keys must equal it. Used after a restore or transfer, so keys handed
 * over by a malicious relay are never adopted.
 */
export function assertKeysMatchIdentity(keys: E2eIdentityKeys, expected: E2ePublicIdentity): void {
  const ok =
    keys.userId === expected.userId &&
    keys.version === expected.version &&
    bytesEqual(signingPublicKey(decodeKey(keys.signPrivateKey)), decodeKey(expected.signPublicKey)) &&
    bytesEqual(boxPublicKey(decodeKey(keys.boxPrivateKey)), decodeKey(expected.boxPublicKey))
  if (!ok) throw new E2eError('identity_mismatch')
}

/**
 * The safety code two people compare to verify nobody (including the server)
 * swapped their keys: 12 groups of 5 digits, identical on both sides because
 * the two identities are ordered by userId first.
 */
export function safetyCode(a: E2ePublicIdentity, b: E2ePublicIdentity): string {
  const [first, second] = [a, b].sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0))
  const digest = sha512(
    canonical([
      'famlin-e2e-v1/safety-code',
      first.userId,
      decodeKey(first.signPublicKey),
      decodeKey(first.boxPublicKey),
      second.userId,
      decodeKey(second.signPublicKey),
      decodeKey(second.boxPublicKey),
    ])
  )
  const groups: string[] = []
  for (let i = 0; i < 12; i++) {
    // 5 bytes → 40-bit number → 5 decimal digits (bias is irrelevant for a
    // human comparison code).
    let n = 0
    for (let j = 0; j < 5; j++) n = n * 256 + digest[i * 5 + j]
    groups.push(String(n % 100000).padStart(5, '0'))
  }
  return groups.join(' ')
}
