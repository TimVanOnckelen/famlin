import { canonical, toBase64 } from './encoding'
import { aeadDecrypt, aeadEncrypt, decodeKey, KEY_BYTES, NONCE_BYTES, randomBytes } from './primitives'

const AAD = canonical(['famlin-e2e-v1/attachment'])

/**
 * Encrypt a whole file in memory with a fresh key. v1 is meant for photos the
 * app has already resized; large videos need a chunked format (a future v2).
 * The key and nonce go into the message's encrypted content, the returned
 * bytes are uploaded as an opaque blob.
 */
export function encryptAttachment(bytes: Uint8Array): { data: Uint8Array; key: string; nonce: string } {
  const key = randomBytes(KEY_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  return { data: aeadEncrypt(key, nonce, bytes, AAD), key: toBase64(key), nonce: toBase64(nonce) }
}

/** Throws E2eError('corrupt') if the blob was tampered with or the key is wrong. */
export function decryptAttachment(data: Uint8Array, key: string, nonce: string): Uint8Array {
  return aeadDecrypt(decodeKey(key), decodeKey(nonce, NONCE_BYTES), data, AAD)
}
