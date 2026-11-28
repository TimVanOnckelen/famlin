import { canonical, toBase64, fromBase64, utf8Decode, utf8Encode } from './encoding'
import { assertKeysMatchIdentity } from './identity'
import { aeadDecrypt, aeadEncrypt, deriveKey, NONCE_BYTES, randomBytes } from './primitives'
import { E2eError, type E2eIdentityKeys, type E2ePublicIdentity, type E2eRecoveryBackupV1 } from './types'

// Crockford base32: no I, L, O or U, so a code survives being read aloud,
// handwritten or retyped.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_BYTES = 20 // 160 bits → exactly 32 characters
const CODE_CHARS = 32
const INFO = 'famlin-e2e-v1/recovery'

function aad(userId: string, version: number): Uint8Array {
  return canonical(['famlin-e2e-v1/recovery-aad', userId, String(version)])
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function decodeBase32(text: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of text) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new E2eError('invalid_recovery_code')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/**
 * A new random recovery code, formatted as 8 groups of 4 characters. Always
 * generated, never user-chosen: the server stores what it protects, so only
 * 160 random bits keep an operator from guessing it offline.
 */
export function generateRecoveryCode(): string {
  return formatRecoveryCode(encodeBase32(randomBytes(CODE_BYTES)))
}

export function formatRecoveryCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)!.join('-')
}

/** Accepts any spacing/dashes/case and the usual look-alikes; throws invalid_recovery_code. */
export function normalizeRecoveryCode(input: string): string {
  const normalized = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (normalized.length !== CODE_CHARS || [...normalized].some((c) => !ALPHABET.includes(c))) {
    throw new E2eError('invalid_recovery_code')
  }
  return normalized
}

function codeKey(code: string, salt: Uint8Array): Uint8Array {
  // The code already carries 160 bits of entropy, so a slow password hash
  // would add nothing but seconds on an older phone; HKDF is enough.
  return deriveKey(decodeBase32(normalizeRecoveryCode(code)), salt, INFO)
}

export function sealRecoveryBackup(keys: E2eIdentityKeys, code: string): E2eRecoveryBackupV1 {
  const salt = randomBytes(16)
  const nonce = randomBytes(NONCE_BYTES)
  const plaintext = utf8Encode(
    JSON.stringify({
      userId: keys.userId,
      version: keys.version,
      signPrivateKey: keys.signPrivateKey,
      boxPrivateKey: keys.boxPrivateKey,
    })
  )
  return {
    v: 1,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ct: toBase64(aeadEncrypt(codeKey(code, salt), nonce, plaintext, aad(keys.userId, keys.version))),
  }
}

/**
 * Opens a backup with the user's code and checks the keys inside match the
 * identity the server publishes. Throws invalid_recovery_code (typo in the
 * format), wrong_recovery_code (doesn't open), identity_mismatch.
 */
export function openRecoveryBackup(backup: unknown, code: string, expected: E2ePublicIdentity): E2eIdentityKeys {
  if (typeof backup !== 'object' || backup === null) throw new E2eError('corrupt')
  const b = backup as Record<string, unknown>
  if (b.v !== 1) throw new E2eError('unknown_version')
  let salt: Uint8Array, nonce: Uint8Array, ct: Uint8Array
  try {
    salt = fromBase64(b.salt as string)
    nonce = fromBase64(b.nonce as string)
    ct = fromBase64(b.ct as string)
  } catch {
    throw new E2eError('corrupt')
  }
  if (nonce.length !== NONCE_BYTES) throw new E2eError('corrupt')
  const derived = codeKey(code, salt)
  let plaintext: Uint8Array
  try {
    plaintext = aeadDecrypt(derived, nonce, ct, aad(expected.userId, expected.version))
  } catch {
    throw new E2eError('wrong_recovery_code')
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(utf8Decode(plaintext))
  } catch {
    throw new E2eError('corrupt')
  }
  const keys: E2eIdentityKeys = {
    userId: parsed.userId as string,
    version: parsed.version as number,
    signPrivateKey: parsed.signPrivateKey as string,
    boxPrivateKey: parsed.boxPrivateKey as string,
    signPublicKey: expected.signPublicKey,
    boxPublicKey: expected.boxPublicKey,
  }
  assertKeysMatchIdentity(keys, expected)
  return keys
}
