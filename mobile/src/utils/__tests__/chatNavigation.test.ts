import { chatEntryTarget, chatUnreadTotal, type ChatEntryGroup } from '../chatNavigation'

const groups: ChatEntryGroup[] = [
  { id: 'g1', name: 'One', chitchatEnabled: true },
  { id: 'g2', name: 'Off', chitchatEnabled: false },
]

it('always opens the unified inbox on capable servers', () => {
  expect(chatEntryTarget('supported', [])).toEqual({ route: 'ChatInbox' })
  expect(chatEntryTarget('supported', groups)).toEqual({ route: 'ChatInbox' })
})

it('preserves legacy no-chat, one-group jump, and multi-group picker behavior', () => {
  expect(chatEntryTarget('unsupported', [])).toBeNull()
  expect(chatEntryTarget('unsupported', groups)).toEqual({
    route: 'Chat',
    params: { groupId: 'g1', groupName: 'One' },
  })
  expect(chatEntryTarget('unsupported', [...groups, { id: 'g3', name: 'Two', chitchatEnabled: true }])).toEqual({
    route: 'ChatGroupPicker',
  })
})

it('uses only one authoritative unread source for each capability mode', () => {
  expect(chatUnreadTotal('supported', { total: 7, byConversation: { p1: 7 } }, { g1: 20 })).toBe(7)
  expect(chatUnreadTotal('unsupported', undefined, { g1: 2, g2: 3 })).toBe(5)
})
