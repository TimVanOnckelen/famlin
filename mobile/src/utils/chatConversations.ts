import { isChatEncryptionSupported, type ChatConversation, type ChatEligiblePerson } from '@famlin/api-client'

export type ChatConversationSection = {
  key: 'family' | 'private'
  data: ChatConversation[]
}

export function chatConversationSections(
  conversations: ChatConversation[],
  currentUserId?: string,
  query = ''
): ChatConversationSection[] {
  const needle = query.trim().toLocaleLowerCase()
  const byUpdatedAt = (a: ChatConversation, b: ChatConversation) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  const matches = conversations.filter(
    (conversation) => !needle || chatConversationTitle(conversation, currentUserId).toLocaleLowerCase().includes(needle)
  )
  const family = matches.filter((conversation) => conversation.kind === 'FAMILY').sort(byUpdatedAt)
  const privateMessages = matches.filter((conversation) => conversation.kind === 'PRIVATE').sort(byUpdatedAt)

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
  | { key: 'chat.previewText'; text: string }
  | { key: 'chat.previewPhoto' | 'chat.previewVideo' | 'chat.previewEmpty' | 'chat.unsupportedEncryption' }

export function chatConversationPreview(conversation: ChatConversation): ChatConversationPreview {
  const last = conversation.lastMessage
  if (!last) return { key: 'chat.previewEmpty' }
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
