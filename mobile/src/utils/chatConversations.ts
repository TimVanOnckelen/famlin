import {
  E2E_MESSAGE_ENCRYPTION,
  isChatEncryptionSupported,
  type ChatConversation,
  type ChatConversationLastMessage,
  type ChatEligiblePerson,
} from '@famlin/api-client'
import type { DecryptResult } from '@/e2e/decrypt'

export type ChatConversationSection = {
  key: 'family' | 'private'
  data: ChatConversation[]
}

export function chatConversationSections(conversations: ChatConversation[]): ChatConversationSection[] {
  const byUpdatedAt = (a: ChatConversation, b: ChatConversation) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  const family = conversations.filter((conversation) => conversation.kind === 'FAMILY').sort(byUpdatedAt)
  const privateMessages = conversations.filter((conversation) => conversation.kind === 'PRIVATE').sort(byUpdatedAt)

  return [
    ...(family.length > 0 ? [{ key: 'family' as const, data: family }] : []),
    ...(privateMessages.length > 0 ? [{ key: 'private' as const, data: privateMessages }] : []),
  ]
}

export function chatConversationTitle(conversation: ChatConversation, currentUserId?: string): string {
  if (conversation.kind === 'FAMILY') return conversation.group?.name ?? ''
  return conversation.participants.find((participant) => participant.id !== currentUserId)?.name ?? ''
}

export type ChatConversationPreview =
  | { key: 'chat.previewText'; text: string; encrypted?: true }
  | { key: 'chat.previewPhoto' | 'chat.previewVideo' | 'chat.previewEmpty'; encrypted?: true }
  | { key: 'chat.previewEncrypted'; encrypted: true }
  | { key: 'chat.unsupportedEncryption' }

/**
 * `decrypt` opens an end-to-end encrypted last message when the caller has the
 * keys; without it (or when it can't) the row says "Encrypted message" rather
 * than guessing. Formats this app doesn't know are never previewed.
 */
export function chatConversationPreview(
  conversation: ChatConversation,
  decrypt?: (last: ChatConversationLastMessage) => DecryptResult
): ChatConversationPreview {
  const last = conversation.lastMessage
  if (!last) return { key: 'chat.previewEmpty' }
  if (last.encryption === E2E_MESSAGE_ENCRYPTION) {
    const result = decrypt?.(last)
    if (result?.status !== 'ok') return { key: 'chat.previewEncrypted', encrypted: true }
    if (result.content.text) return { key: 'chat.previewText', text: result.content.text, encrypted: true }
    if (result.content.attachment) return { key: 'chat.previewPhoto', encrypted: true }
    return { key: 'chat.previewEmpty', encrypted: true }
  }
  if (!isChatEncryptionSupported(last.encryption)) return { key: 'chat.unsupportedEncryption' }
  if (last.content) return { key: 'chat.previewText', text: last.content }
  if (last.hasAttachment) return { key: 'chat.previewPhoto' }
  return { key: 'chat.previewEmpty' }
}

export function eligibleChatPeople(
  people: ChatEligiblePerson[],
  currentUserId: string | undefined,
  query: string
): ChatEligiblePerson[] {
  const needle = query.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  return people.filter((person) => {
    if (person.id === currentUserId || seen.has(person.id)) return false
    if (needle && !person.name.toLocaleLowerCase().includes(needle)) return false
    seen.add(person.id)
    return true
  })
}
