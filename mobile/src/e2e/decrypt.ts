import {
  decryptMessage,
  E2eError,
  parseMessagePayload,
  type E2eErrorCode,
  type E2eIdentityKeys,
  type E2eMessageContentV1,
  type E2ePublicIdentity,
} from '@famlin/api-client'
import { getCachedContent, setCachedContent } from '@/e2e/cache'

export type DecryptFailure = E2eErrorCode | 'missing_identity'

export type DecryptResult =
  | { status: 'ok'; content: E2eMessageContentV1 }
  /** The sender's identities haven't been fetched yet. */
  | { status: 'pending' }
  | { status: 'error'; code: DecryptFailure }

/** i18n key explaining why a message can't be shown. Never silent. */
export function decryptErrorKey(code: DecryptFailure): string {
  switch (code) {
    case 'no_key_for_me':
      return 'e2e.error.noKeyForMe'
    case 'unknown_version':
      return 'e2e.error.unknownVersion'
    case 'bad_signature':
    case 'sender_key_mismatch':
      return 'e2e.error.badSignature'
    default:
      return 'e2e.error.corrupt'
  }
}

export interface DecryptInput {
  messageId: string
  conversationId: string
  authorId: string
  payload: unknown
  myKeys: E2eIdentityKeys[]
  /** The author's published identity versions, or undefined while loading. */
  senderIdentities: E2ePublicIdentity[] | undefined
}

export function decryptChatPayload(input: DecryptInput): DecryptResult {
  const cached = getCachedContent(input.messageId)
  if (cached) return { status: 'ok', content: cached }
  try {
    const payload = parseMessagePayload(input.payload)
    if (!input.senderIdentities) return { status: 'pending' }
    const senderIdentity = input.senderIdentities.find((identity) => identity.version === payload.senderKeyVersion)
    if (!senderIdentity) return { status: 'error', code: 'missing_identity' }
    const content = decryptMessage({
      payload,
      conversationId: input.conversationId,
      authorId: input.authorId,
      senderIdentity,
      myKeys: input.myKeys,
    })
    setCachedContent(input.messageId, content)
    return { status: 'ok', content }
  } catch (error) {
    return { status: 'error', code: error instanceof E2eError ? error.code : 'corrupt' }
  }
}

/** Short text for a message list preview / reply quote when the plaintext isn't available. */
export function contentPreviewKind(content: E2eMessageContentV1): 'text' | 'photo' | 'empty' {
  if (content.text) return 'text'
  if (content.attachment) return 'photo'
  return 'empty'
}

/**
 * Drop messages whose plaintext `mid` already appeared in an earlier one (a
 * server replaying a ciphertext). `messages` is newest first, like the list;
 * the oldest occurrence wins. Messages that can't be decrypted stay.
 */
export function dedupeByMid<T>(
  messages: T[],
  idOf: (message: T) => string,
  midOf: (message: T) => string | undefined
): T[] {
  const seen = new Set<string>()
  const keep = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const mid = midOf(messages[i])
    if (mid) {
      if (seen.has(mid)) continue
      seen.add(mid)
    }
    keep.add(idOf(messages[i]))
  }
  return messages.filter((message) => keep.has(idOf(message)))
}
