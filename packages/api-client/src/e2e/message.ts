import { canonical, fromBase64, toBase64, utf8Decode, utf8Encode } from './encoding'
import {
  aeadDecrypt,
  aeadEncrypt,
  decodeKey,
  KEY_BYTES,
  NONCE_BYTES,
  openSealed,
  randomBytes,
  sealTo,
  sign,
  verify,
} from './primitives'
import {
  E2eError,
  type E2eIdentityKeys,
  type E2eKeyEntryV1,
  type E2eMessageContentV1,
  type E2eMessagePayloadV1,
  type E2ePublicIdentity,
} from './types'

const WRAP_INFO = 'famlin-e2e-v1/message-key'

function contentAad(conversationId: string, authorId: string): Uint8Array {
  return canonical(['famlin-e2e-v1/message-content', conversationId, authorId])
}

function wrapAad(conversationId: string, authorId: string, userId: string, keyVersion: number): Uint8Array {
  return canonical(['famlin-e2e-v1/message-key-aad', conversationId, authorId, userId, String(keyVersion)])
}

function sortedKeys(keys: E2eKeyEntryV1[]): E2eKeyEntryV1[] {
  return [...keys].sort((a, b) => (a.userId === b.userId ? a.keyVersion - b.keyVersion : a.userId < b.userId ? -1 : 1))
}

/** Everything the sender signs: the whole payload bound to its conversation and author. */
function signedBytes(payload: Omit<E2eMessagePayloadV1, 'sig'>, conversationId: string, authorId: string): Uint8Array {
  return canonical([
    'famlin-e2e-v1/message-signature',
    conversationId,
    authorId,
    String(payload.senderKeyVersion),
    payload.nonce,
    payload.ct,
    ...sortedKeys(payload.keys).flatMap((entry) => [
      entry.userId,
      String(entry.keyVersion),
      entry.epk,
      entry.nonce,
      entry.wk,
    ]),
  ])
}

/** A random message id for E2eMessageContentV1.mid. */
export function newMessageId(): string {
  return toBase64(randomBytes(16))
}

export interface EncryptMessageInput {
  conversationId: string
  /** The sender's own current identity (private keys). */
  sender: E2eIdentityKeys
  /** Every participant's current public identity; the sender is added if missing. */
  recipients: E2ePublicIdentity[]
  content: E2eMessageContentV1
}

export function encryptMessage({
  conversationId,
  sender,
  recipients,
  content,
}: EncryptMessageInput): E2eMessagePayloadV1 {
  const audience = new Map<string, E2ePublicIdentity>()
  for (const recipient of recipients) audience.set(recipient.userId, recipient)
  audience.set(sender.userId, {
    userId: sender.userId,
    version: sender.version,
    signPublicKey: sender.signPublicKey,
    boxPublicKey: sender.boxPublicKey,
  })

  const contentKey = randomBytes(KEY_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  const ct = aeadEncrypt(
    contentKey,
    nonce,
    utf8Encode(JSON.stringify(content)),
    contentAad(conversationId, sender.userId)
  )

  const keys: E2eKeyEntryV1[] = sortedKeys(
    [...audience.values()].map((recipient) => {
      const sealed = sealTo(
        contentKey,
        decodeKey(recipient.boxPublicKey),
        WRAP_INFO,
        wrapAad(conversationId, sender.userId, recipient.userId, recipient.version)
      )
      return {
        userId: recipient.userId,
        keyVersion: recipient.version,
        epk: sealed.epk,
        nonce: sealed.nonce,
        wk: sealed.ct,
      }
    })
  )

  const unsigned = { v: 1 as const, senderKeyVersion: sender.version, nonce: toBase64(nonce), ct: toBase64(ct), keys }
  const sig = sign(signedBytes(unsigned, conversationId, sender.userId), decodeKey(sender.signPrivateKey))
  return { ...unsigned, sig: toBase64(sig) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(record: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => typeof record[field] === 'string')
}

/** Strict shape check of a stored payload; throws unknown_version / corrupt. */
export function parseMessagePayload(value: unknown): E2eMessagePayloadV1 {
  if (!isRecord(value)) throw new E2eError('corrupt')
  if (value.v !== 1) throw new E2eError('unknown_version')
  const positiveInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1
  if (!strings(value, ['nonce', 'ct', 'sig']) || !positiveInt(value.senderKeyVersion) || !Array.isArray(value.keys)) {
    throw new E2eError('corrupt')
  }
  const keys = value.keys.map((entry: unknown) => {
    if (!isRecord(entry) || !strings(entry, ['userId', 'epk', 'nonce', 'wk']) || !positiveInt(entry.keyVersion)) {
      throw new E2eError('corrupt')
    }
    return {
      userId: entry.userId as string,
      keyVersion: entry.keyVersion as number,
      epk: entry.epk as string,
      nonce: entry.nonce as string,
      wk: entry.wk as string,
    }
  })
  return {
    v: 1,
    senderKeyVersion: value.senderKeyVersion as number,
    nonce: value.nonce as string,
    ct: value.ct as string,
    keys,
    sig: value.sig as string,
  }
}

export interface DecryptMessageInput {
  payload: unknown
  conversationId: string
  authorId: string
  /** The author's published identity for `payload.senderKeyVersion`. */
  senderIdentity: E2ePublicIdentity
  /** Every identity version this device holds for the current user. */
  myKeys: E2eIdentityKeys[]
}

/**
 * Verify, then decrypt. The signature is checked before anything is opened,
 * so a server that rewrote the key list or forged the author is rejected
 * (`bad_signature`) rather than producing attacker-chosen plaintext.
 */
export function decryptMessage({
  payload: raw,
  conversationId,
  authorId,
  senderIdentity,
  myKeys,
}: DecryptMessageInput): E2eMessageContentV1 {
  const payload = parseMessagePayload(raw)
  if (senderIdentity.userId !== authorId || senderIdentity.version !== payload.senderKeyVersion) {
    throw new E2eError('sender_key_mismatch')
  }
  let signature: Uint8Array
  try {
    signature = fromBase64(payload.sig)
  } catch {
    throw new E2eError('corrupt')
  }
  const { sig: _sig, ...unsigned } = payload
  if (!verify(signature, signedBytes(unsigned, conversationId, authorId), decodeKey(senderIdentity.signPublicKey))) {
    throw new E2eError('bad_signature')
  }

  let entry: E2eKeyEntryV1 | undefined
  let mine: E2eIdentityKeys | undefined
  for (const keys of myKeys) {
    entry = payload.keys.find((candidate) => candidate.userId === keys.userId && candidate.keyVersion === keys.version)
    if (entry) {
      mine = keys
      break
    }
  }
  if (!entry || !mine) throw new E2eError('no_key_for_me')

  const contentKey = openSealed(
    { epk: entry.epk, nonce: entry.nonce, ct: entry.wk },
    decodeKey(mine.boxPrivateKey),
    WRAP_INFO,
    wrapAad(conversationId, authorId, entry.userId, entry.keyVersion)
  )
  if (contentKey.length !== KEY_BYTES) throw new E2eError('corrupt')

  let nonce: Uint8Array
  let ct: Uint8Array
  try {
    nonce = fromBase64(payload.nonce)
    ct = fromBase64(payload.ct)
  } catch {
    throw new E2eError('corrupt')
  }
  if (nonce.length !== NONCE_BYTES) throw new E2eError('corrupt')
  const plaintext = aeadDecrypt(contentKey, nonce, ct, contentAad(conversationId, authorId))

  let content: unknown
  try {
    content = JSON.parse(utf8Decode(plaintext))
  } catch {
    throw new E2eError('corrupt')
  }
  if (!isRecord(content) || typeof content.mid !== 'string') throw new E2eError('corrupt')
  if (content.text !== undefined && typeof content.text !== 'string') throw new E2eError('corrupt')
  if (content.attachment !== undefined) {
    const a = content.attachment
    if (!isRecord(a) || !strings(a, ['url', 'key', 'nonce', 'mime']) || typeof a.size !== 'number') {
      throw new E2eError('corrupt')
    }
  }
  return content as unknown as E2eMessageContentV1
}
