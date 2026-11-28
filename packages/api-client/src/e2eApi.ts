// Network calls for end-to-end encrypted direct messages (#506). The server
// only stores public keys, ciphertext and the recovery backup (itself
// encrypted under the user's recovery code); all crypto lives in ./e2e.

import { api } from './client'
import type { E2eMessagePayloadV1, E2eRecoveryBackupV1, E2eTransferPayloadV1 } from './e2e/types'
import type { ChatConversationMessage } from './chat'
import { UPLOAD_TIMEOUT_MS } from './uploads'

export interface E2ePublishedIdentity {
  version: number
  signPublicKey: string
  boxPublicKey: string
  createdAt: string
}

export interface E2eOwnIdentity extends E2ePublishedIdentity {
  recoveryBackup: E2eRecoveryBackupV1 | null
}

export const e2eMyIdentitiesQueryKey = () => ['e2e', 'identity', 'me'] as const
export const e2eUserIdentitiesQueryKey = (userId: string) => ['e2e', 'identity', userId] as const

/** Your own identity versions, newest first — the only response carrying recoveryBackup. */
export async function fetchMyE2eIdentities(): Promise<E2eOwnIdentity[]> {
  // requires-feature: e2eDirectMessages
  const response = await api.get<{ identities: E2eOwnIdentity[] }>('/e2e/identity/me')
  return response.data.identities
}

/** Another user's published identity versions, newest first (empty if they have none yet). */
export async function fetchUserE2eIdentities(userId: string): Promise<E2ePublishedIdentity[]> {
  // requires-feature: e2eDirectMessages
  const response = await api.get<{ userId: string; identities: E2ePublishedIdentity[] }>(
    `/e2e/identity/${encodeURIComponent(userId)}`
  )
  return response.data.identities
}

export interface PublishE2eIdentityBody {
  version: number
  signPublicKey: string
  boxPublicKey: string
  recoveryBackup?: E2eRecoveryBackupV1
}

/** Publish a new identity version (1 the first time, latest + 1 on a key reset). 409 if not next. */
export async function publishE2eIdentity(body: PublishE2eIdentityBody): Promise<E2ePublishedIdentity> {
  // requires-feature: e2eDirectMessages
  const response = await api.post<E2ePublishedIdentity>('/e2e/identity', body)
  return response.data
}

/** Replace (or with null remove) the recovery backup of your latest identity version. */
export async function updateE2eRecoveryBackup(
  version: number,
  recoveryBackup: E2eRecoveryBackupV1 | null
): Promise<void> {
  // requires-feature: e2eDirectMessages
  await api.put(`/e2e/identity/${version}/recovery`, { recoveryBackup })
}

/** Existing device: hand the sealed identity to the new device's QR session. */
export async function putE2eTransfer(sessionId: string, payload: E2eTransferPayloadV1): Promise<void> {
  // requires-feature: e2eDirectMessages
  await api.put(`/e2e/transfers/${encodeURIComponent(sessionId)}`, { payload })
}

/** New device: poll for the sealed identity. Resolves null while it isn't there yet (404). */
export async function takeE2eTransfer(sessionId: string): Promise<E2eTransferPayloadV1 | null> {
  try {
    // requires-feature: e2eDirectMessages
    const response = await api.get<{ payload: E2eTransferPayloadV1 }>(`/e2e/transfers/${encodeURIComponent(sessionId)}`)
    return response.data.payload
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 404) return null
    throw error
  }
}

export interface SendEncryptedChatMessageBody {
  encryption: 'v1'
  encryptedPayload: E2eMessagePayloadV1
  /** The `/uploads/<uuid>.bin` path from uploadEncryptedAttachment, if any. */
  attachmentUrl?: string
  replyToMessageId?: string
}

export async function sendEncryptedChatMessage(
  conversationId: string,
  body: SendEncryptedChatMessageBody
): Promise<ChatConversationMessage> {
  // requires-feature: e2eDirectMessages
  const response = await api.post<ChatConversationMessage>(`/chat/conversations/${conversationId}/messages`, body)
  return response.data
}

/**
 * Upload an already-encrypted attachment as an opaque blob. `file` is
 * whatever the platform's FormData accepts: a Blob on web, a
 * `{ uri, name, type }` object on React Native.
 */
export async function uploadEncryptedAttachment(file: unknown): Promise<string> {
  const formData = new FormData()
  formData.append('file', file as Blob)
  // requires-feature: e2eDirectMessages
  const response = await api.post<{ url: string }>('/uploads/encrypted', formData, {
    headers: { 'Content-Type': undefined },
    timeout: UPLOAD_TIMEOUT_MS,
  })
  return response.data.url
}

export interface ChatConversationEncryptionState {
  encryptionDisabledAt: string | null
  encryptionDisabledById: string | null
}

/** Opt a private conversation out of (or back into) encryption; posts a visible system message. */
export async function setChatConversationEncryption(
  conversationId: string,
  enabled: boolean
): Promise<ChatConversationEncryptionState> {
  // requires-feature: e2eDirectMessages
  const response = await api.put<ChatConversationEncryptionState>(`/chat/conversations/${conversationId}/encryption`, {
    enabled,
  })
  return response.data
}
