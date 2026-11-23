import type { ChatConversationUnreadCounts, FeatureSupport } from '@famlin/api-client'

export interface ChatEntryGroup {
  id: string
  name: string
  chitchatEnabled?: boolean
}

export type ChatEntryTarget =
  | { route: 'ChatInbox' }
  | { route: 'ChatGroupPicker' }
  | { route: 'Chat'; params: { groupId: string; groupName: string } }

export function chatEntryTarget(support: FeatureSupport, groups: ChatEntryGroup[]): ChatEntryTarget | null {
  if (support === 'supported') return { route: 'ChatInbox' }

  const chatGroups = groups.filter((group) => group.chitchatEnabled)
  if (chatGroups.length === 0) return null
  if (chatGroups.length > 1) return { route: 'ChatGroupPicker' }
  return {
    route: 'Chat',
    params: { groupId: chatGroups[0].id, groupName: chatGroups[0].name },
  }
}

export function chatUnreadTotal(
  support: FeatureSupport,
  conversationCounts: ChatConversationUnreadCounts | undefined,
  legacyCounts: Record<string, number> | undefined
): number {
  if (support === 'supported') return conversationCounts?.total ?? 0
  return Object.values(legacyCounts ?? {}).reduce((sum, count) => sum + count, 0)
}
