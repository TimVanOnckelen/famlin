import { api } from './api/client'

export interface SetupChecklist {
  groupExists: boolean
  adminInGroup: boolean
  invited: boolean
  backupsOn: boolean
  firstGroupId: string | null
}

const DISMISS_KEY = 'famlin_admin_checklist_dismissed'

export const isChecklistDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export const dismissChecklist = () => {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Storage blocked: the card simply stays visible.
  }
}

export const isChecklistComplete = (c: SetupChecklist) => c.groupExists && c.adminInGroup && c.invited && c.backupsOn

// Derived entirely from real server state through existing admin endpoints,
// so it never drifts from what the admin actually did (or did elsewhere).
export async function loadSetupChecklist(): Promise<SetupChecklist> {
  const [me, groups, users, settings] = await Promise.all([
    api.getMe(),
    api.getGroups(),
    api.getUsers(),
    api.getSettings(),
  ])
  const members = await Promise.all(groups.map((g) => api.getGroupMembers(g.id).catch(() => [])))
  const adminInGroup = members.some((list) => list.some((m) => m.id === me.id))
  const hasOtherUser = users.items.some((u) => u.id !== me.id)
  let invited = hasOtherUser
  if (!invited) {
    const invites = await Promise.all(groups.map((g) => api.getGroupInvites(g.id).catch(() => [])))
    invited = invites.some((list) => list.length > 0)
  }
  return {
    groupExists: groups.length > 0,
    adminInGroup,
    invited,
    backupsOn: settings.backupEnabled,
    firstGroupId: groups[0]?.id ?? null,
  }
}
