// Device-to-device hand-over ("link a new device"), like WhatsApp's QR flow:
// the NEW device shows a QR with a fresh one-time public key; an already set
// up device scans it and seals the identity to that key; the server only
// relays the sealed box under the QR's session id.

import { canonical, toBase64, utf8Decode, utf8Encode } from './encoding'
import { assertKeysMatchIdentity } from './identity'
import { decodeKey, generateBoxKeyPair, openSealed, randomBytes, sealTo } from './primitives'
import { E2eError, type E2eIdentityKeys, type E2ePublicIdentity, type E2eTransferPayloadV1 } from './types'

const INFO = 'famlin-e2e-v1/transfer'
const QR_PREFIX = 'famlin-e2e-transfer:1:'

function aad(sessionId: string, userId: string): Uint8Array {
  return canonical(['famlin-e2e-v1/transfer-aad', sessionId, userId])
}

export interface TransferRequest {
  sessionId: string
  /** Stays on the new device; never leaves it. */
  privateKey: string
  /** What the new device renders as a QR code. */
  qr: string
}

export function createTransferRequest(): TransferRequest {
  const keyPair = generateBoxKeyPair()
  // base64 without +/= so the id is URL- and route-safe.
  const sessionId = toBase64(randomBytes(18)).replace(/\+/g, '-').replace(/\//g, '_')
  return {
    sessionId,
    privateKey: toBase64(keyPair.privateKey),
    qr: `${QR_PREFIX}${sessionId}:${toBase64(keyPair.publicKey)}`,
  }
}

export function parseTransferQr(qr: string): { sessionId: string; publicKey: string } {
  if (typeof qr !== 'string' || !qr.startsWith(QR_PREFIX)) throw new E2eError('invalid_transfer_code')
  const [sessionId, publicKey] = qr.slice(QR_PREFIX.length).split(':')
  if (!sessionId || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId) || !publicKey) throw new E2eError('invalid_transfer_code')
  try {
    decodeKey(publicKey)
  } catch {
    throw new E2eError('invalid_transfer_code')
  }
  return { sessionId, publicKey }
}

/** On the existing device, after scanning: seal our identity to the new device. */
export function sealTransfer(keys: E2eIdentityKeys, qr: string): { sessionId: string; payload: E2eTransferPayloadV1 } {
  const { sessionId, publicKey } = parseTransferQr(qr)
  const secret = utf8Encode(
    JSON.stringify({
      userId: keys.userId,
      version: keys.version,
      signPrivateKey: keys.signPrivateKey,
      boxPrivateKey: keys.boxPrivateKey,
    })
  )
  const sealed = sealTo(secret, decodeKey(publicKey), INFO, aad(sessionId, keys.userId))
  return { sessionId, payload: { v: 1, ...sealed } }
}

/**
 * On the new device: open the relayed payload and check the keys belong to
 * the identity the server publishes for us (so a relay can't plant its own).
 */
export function openTransfer(
  payload: unknown,
  request: Pick<TransferRequest, 'sessionId' | 'privateKey'>,
  expected: E2ePublicIdentity
): E2eIdentityKeys {
  if (typeof payload !== 'object' || payload === null) throw new E2eError('corrupt')
  const p = payload as Record<string, unknown>
  if (p.v !== 1) throw new E2eError('unknown_version')
  if (typeof p.epk !== 'string' || typeof p.nonce !== 'string' || typeof p.ct !== 'string') {
    throw new E2eError('corrupt')
  }
  const plaintext = openSealed(
    { epk: p.epk, nonce: p.nonce, ct: p.ct },
    decodeKey(request.privateKey),
    INFO,
    aad(request.sessionId, expected.userId)
  )
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
