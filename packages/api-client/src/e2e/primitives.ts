// The only place the E2E module touches cryptographic primitives. Everything
// is audited @noble code; nothing here is home-grown cryptography, only how
// the primitives are combined.

import { ed25519, x25519 } from '@noble/curves/ed25519'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes as nobleRandomBytes } from '@noble/ciphers/webcrypto'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256, sha512 } from '@noble/hashes/sha2'
import { E2eError } from './types'
import { canonical, fromBase64, toBase64 } from './encoding'

export const KEY_BYTES = 32
export const NONCE_BYTES = 24

/** Needs globalThis.crypto.getRandomValues (browsers, Node; on Hermes via a polyfill). */
export function randomBytes(length: number): Uint8Array {
  return nobleRandomBytes(length)
}

export function aeadEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext)
}

/** Throws E2eError('corrupt') on any authentication failure. */
export function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext)
  } catch {
    throw new E2eError('corrupt')
  }
}

export function deriveKey(ikm: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, ikm, salt, info, KEY_BYTES)
}

export function generateSigningKeyPair() {
  const privateKey = ed25519.utils.randomPrivateKey()
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}

export function generateBoxKeyPair() {
  const privateKey = x25519.utils.randomPrivateKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}

export function signingPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey)
}

export function boxPublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey)
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey)
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey)
  } catch {
    return false
  }
}

export { sha512 }

export interface SealedBox {
  epk: string
  nonce: string
  ct: string
}

/**
 * Encrypt `secret` so only the holder of `recipientBoxPublicKey`'s private key
 * can open it: ephemeral X25519 → HKDF-SHA256 (salt = epk ‖ recipient key,
 * info = domain label) → XChaCha20-Poly1305 with the caller's AAD.
 */
export function sealTo(
  secret: Uint8Array,
  recipientBoxPublicKey: Uint8Array,
  info: string,
  aad: Uint8Array
): SealedBox {
  const ephemeral = generateBoxKeyPair()
  const shared = x25519.getSharedSecret(ephemeral.privateKey, recipientBoxPublicKey)
  const kek = deriveKey(shared, canonical([ephemeral.publicKey, recipientBoxPublicKey]), info)
  const nonce = randomBytes(NONCE_BYTES)
  return {
    epk: toBase64(ephemeral.publicKey),
    nonce: toBase64(nonce),
    ct: toBase64(aeadEncrypt(kek, nonce, secret, aad)),
  }
}

/** Inverse of sealTo; throws E2eError('corrupt') if anything doesn't match. */
export function openSealed(
  box: SealedBox,
  recipientBoxPrivateKey: Uint8Array,
  info: string,
  aad: Uint8Array
): Uint8Array {
  let epk: Uint8Array
  let nonce: Uint8Array
  let ct: Uint8Array
  let shared: Uint8Array
  try {
    epk = fromBase64(box.epk)
    nonce = fromBase64(box.nonce)
    ct = fromBase64(box.ct)
    if (epk.length !== KEY_BYTES || nonce.length !== NONCE_BYTES) throw new Error('length')
    shared = x25519.getSharedSecret(recipientBoxPrivateKey, epk)
  } catch {
    throw new E2eError('corrupt')
  }
  const recipientPublicKey = boxPublicKey(recipientBoxPrivateKey)
  const kek = deriveKey(shared, canonical([epk, recipientPublicKey]), info)
  return aeadDecrypt(kek, nonce, ct, aad)
}

/** Decode a base64 key field, requiring an exact length. */
export function decodeKey(value: unknown, length: number = KEY_BYTES): Uint8Array {
  if (typeof value !== 'string') throw new E2eError('corrupt')
  let bytes: Uint8Array
  try {
    bytes = fromBase64(value)
  } catch {
    throw new E2eError('corrupt')
  }
  if (bytes.length !== length) throw new E2eError('corrupt')
  return bytes
}
