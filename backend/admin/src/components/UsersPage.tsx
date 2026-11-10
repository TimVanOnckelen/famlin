import { InitialAvatar } from './common/InitialAvatar'
import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableActionsCell } from '@famlin/ui/table'
import { Badge } from '@famlin/ui/badge'
import { AdminModal } from './AdminModal'
import { DialogActions } from '@famlin/ui/dialog'
import { useAdminDialogs } from './AdminDialogs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, User, Group } from '../api/client'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { Icon } from './Icon'
import { AddMemberModal } from './AddMemberModal'

export function UsersPage() {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [users, setUsers] = useState<User[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const loadedPages = useRef(1)
  const requestVersion = useRef(0)
  const [showAddMember, setShowAddMember] = useState(false)
  const [managingUser, setManagingUser] = useState<User | null>(null)

  const nextRequestVersion = useCallback(() => ++requestVersion.current, [])

  // Background refreshes must keep open dialogs mounted, including the newly
  // generated invitation link, so updates flow through setState (not a page
  // reload).
  const load = useCallback(async () => {
    const version = nextRequestVersion()
    setRefreshing(true)
    setLoadingMore(false)
    setError('')
    try {
      const [roster, groupList] = await Promise.all([
        (async () => {
          const items: User[] = []
          let cursor: string | undefined
          for (let pageIndex = 0; pageIndex < loadedPages.current; pageIndex++) {
            const page = await api.getUsers(cursor ? { cursor } : {})
            items.push(...page.items)
            cursor = page.nextCursor ?? undefined
            if (!cursor) break
          }
          return { items, nextCursor: cursor ?? null }
        })(),
        api.getGroups(),
      ])
      if (version !== requestVersion.current) return
      setUsers(roster.items)
      setNextCursor(roster.nextCursor)
      setGroups(groupList)
      setManagingUser((current) => (current ? (roster.items.find((user) => user.id === current.id) ?? null) : null))
    } catch (err) {
      if (version === requestVersion.current) setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      if (version === requestVersion.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [t, nextRequestVersion])

  const loadMore = async () => {
    if (!nextCursor || loadingMore || refreshing) return
    const version = nextRequestVersion()
    // A concurrent refresh must include this requested page as well.
    loadedPages.current++
    setLoadingMore(true)
    setError('')
    try {
      const page = await api.getUsers({ cursor: nextCursor })
      if (version !== requestVersion.current) return
      setUsers((current) => [...new Map([...current, ...page.items].map((user) => [user.id, user])).values()])
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (version === requestVersion.current) {
        loadedPages.current--
        setError(err instanceof Error ? err.message : t('common.error'))
      }
    } finally {
      if (version === requestVersion.current) setLoadingMore(false)
    }
  }

  useEffect(() => {
    void load()
    return () => {
      nextRequestVersion()
    }
  }, [load, nextRequestVersion])

  const toggleAdmin = async (user: User) => {
    const confirmed = await dialogs.confirmAction(
      t(user.isAdmin ? 'users.revokeAdminConfirm' : 'users.grantAdminConfirm', { name: user.name, email: user.email })
    )
    if (!confirmed) return
    try {
      await api.updateUser(user.id, { isAdmin: !user.isAdmin })
      load()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  // The table shows a single push/email toggle per user as a quick bulk
  // on/off switch; per-event-type granularity is managed by the user in the app.
  const isEmailEnabled = (user: User) => user.emailOnNewPost || user.emailOnNewComment || user.emailOnNewLike

  const toggleEmailNotifications = async (user: User) => {
    const enabled = !isEmailEnabled(user)
    await api.updateUser(user.id, {
      emailOnNewPost: enabled,
      emailOnNewComment: enabled,
      emailOnNewLike: enabled,
    })
    load()
  }

  const isPushEnabled = (user: User) => user.pushOnNewPost || user.pushOnNewComment || user.pushOnNewLike

  const togglePushNotifications = async (user: User) => {
    const enabled = !isPushEnabled(user)
    await api.updateUser(user.id, {
      pushOnNewPost: enabled,
      pushOnNewComment: enabled,
      pushOnNewLike: enabled,
    })
    load()
  }

  const handleDelete = async (user: User) => {
    if (!(await dialogs.confirmAction(t('users.deleteConfirm', { name: user.name, email: user.email })))) {
      return
    }
    try {
      await api.deleteUser(user.id)
      load()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleResetPassword = async (user: User) => {
    const saved = await dialogs.requestPassword(
      t('users.resetPasswordPrompt', { name: user.name, email: user.email }),
      {
        onSubmit: (password) => api.resetPassword(user.id, password),
      }
    )
    if (saved) await dialogs.showMessage(t('users.passwordChanged', { name: user.name }))
  }

  if (loading)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  return (
    <>
      <PageHeader
        title={t('users.title')}
        actions={
          <>
            <Button onClick={() => setShowAddMember(true)}>{t('members.addMember')}</Button>
          </>
        }
      />

      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}{' '}
          <Button variant="link" type="button" className="link-button" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </StateMessage>
      )}
      <Card className="p-6 gap-4" aria-busy={refreshing || loadingMore}>
        {users.length === 0 ? (
          !error && (
            <StateMessage variant="empty" className="empty">
              {t('users.noUsers')}
            </StateMessage>
          )
        ) : (
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.table.name')}</TableHead>
                <TableHead>{t('users.table.groups')}</TableHead>
                <TableHead>{t('users.table.admin')}</TableHead>
                <TableHead>{t('users.table.notifications')}</TableHead>
                <TableHead>{t('users.table.memberSince')}</TableHead>
                <TableHead>{t('users.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <InitialAvatar name={user.name} avatarUrl={user.avatarUrl} />
                      <div className="min-w-0">
                        {' '}
                        <span className="cell-name">
                          {user.name}
                          {!user.hasPassword && <Badge variant="accent">{t('users.table.sso')}</Badge>}
                        </span>
                        <span className="cell-email">{user.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell label={t('users.table.groups')}>
                    <div className="group-badges">
                      {user.groups && user.groups.length > 0 ? (
                        user.groups.map((g) => (
                          <Badge variant="secondary" key={g.id} className="badge">
                            {g.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="muted">{t('users.noGroups')}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell label={t('users.table.admin')}>
                    <Button
                      variant="ghost"
                      type="button"
                      className={`mini-toggle${user.isAdmin ? ' active' : ''}`}
                      title={t('users.table.admin')}
                      aria-label={t('users.table.admin')}
                      aria-pressed={user.isAdmin}
                      onClick={() => void toggleAdmin(user)}
                    >
                      <Icon name="shield" size={14} />
                    </Button>
                  </TableCell>
                  <TableCell label={t('users.table.notifications')}>
                    <div className="toggle-group">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`mini-toggle${isPushEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.pushNotifications')}
                        aria-label={t('users.table.pushNotifications')}
                        aria-pressed={isPushEnabled(user)}
                        onClick={() => void togglePushNotifications(user)}
                      >
                        <Icon name="bell" size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`mini-toggle${isEmailEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.emailNotifications')}
                        aria-label={t('users.table.emailNotifications')}
                        aria-pressed={isEmailEnabled(user)}
                        onClick={() => void toggleEmailNotifications(user)}
                      >
                        <Icon name="mail" size={16} />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell label={t('users.table.memberSince')}>
                    {new Date(user.createdAt).toLocaleDateString(i18n.language)}
                  </TableCell>
                  <TableActionsCell className="actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="icon-button"
                      title={t('users.manageGroups')}
                      aria-label={t('users.manageGroups')}
                      onClick={() => setManagingUser(user)}
                    >
                      <Icon name="users" size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="icon-button"
                      title={t('users.password')}
                      aria-label={t('users.password')}
                      onClick={() => handleResetPassword(user)}
                    >
                      <Icon name="key" size={15} />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="icon-button danger"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => handleDelete(user)}
                    >
                      <Icon name="trash" size={15} />
                    </Button>
                  </TableActionsCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {nextCursor && (
          <Button variant="secondary" className="secondary" disabled={loadingMore || refreshing} onClick={loadMore}>
            {loadingMore ? t('common.loading') : t('common.loadMore')}
          </Button>
        )}
      </Card>

      {managingUser && (
        <ManageGroupsModal user={managingUser} groups={groups} onClose={() => setManagingUser(null)} onChanged={load} />
      )}

      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onCreated={load} />}
    </>
  )
}

interface ManageGroupsModalProps {
  user: User
  groups: Group[]
  onClose: () => void
  onChanged: () => Promise<void>
}

function ManageGroupsModal({ user, groups, onClose, onChanged }: ManageGroupsModalProps) {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null)
  const memberGroupIds = new Set((user.groups ?? []).map((g) => g.id))

  const toggleMembership = async (group: Group, isMember: boolean) => {
    setBusyGroupId(group.id)
    try {
      if (isMember) {
        await api.removeGroupMember(group.id, user.id)
      } else {
        await api.addGroupMember(group.id, user.id)
      }
      await onChanged()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      await dialogs.showMessage(t('users.membershipError', { error: message }))
    } finally {
      setBusyGroupId(null)
    }
  }

  return (
    <AdminModal
      title={
        <span className="inline-flex items-center gap-3">
          <InitialAvatar name={user.name} avatarUrl={user.avatarUrl} />
          {t('users.manageGroupsFor', { name: user.name })}
        </span>
      }
      onClose={onClose}
      busy={!!busyGroupId}
    >
      {groups.length === 0 ? (
        <StateMessage variant="empty" className="empty">
          {t('groups.noGroups')}
        </StateMessage>
      ) : (
        <ul className="membership-list">
          {groups.map((group) => {
            const isMember = memberGroupIds.has(group.id)
            return (
              <li key={group.id} className="membership-row">
                <span>{group.name}</span>
                <Button
                  variant={isMember ? 'destructive' : 'default'}
                  disabled={!!busyGroupId}
                  onClick={() => toggleMembership(group, isMember)}
                >
                  {isMember ? t('common.remove') : t('common.add')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <DialogActions>
        <Button variant="secondary" className="secondary" onClick={onClose} disabled={!!busyGroupId}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </AdminModal>
  )
}
