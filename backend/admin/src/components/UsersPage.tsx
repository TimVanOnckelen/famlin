import { AdminModal } from './AdminModal'
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

  if (loading) return <div className="loading">{t('common.loading')}</div>

  return (
    <>
      <div className="page-header">
        <h2>{t('users.title')}</h2>
        <button onClick={() => setShowAddMember(true)}>{t('members.addMember')}</button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      <div className="card" aria-busy={refreshing || loadingMore}>
        {users.length === 0 ? (
          !error && <div className="empty">{t('users.noUsers')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('users.table.name')}</th>
                <th>{t('users.table.groups')}</th>
                <th>{t('users.table.admin')}</th>
                <th>{t('users.table.notifications')}</th>
                <th>{t('users.table.memberSince')}</th>
                <th>{t('users.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="cell-name">
                      {user.name}
                      {!user.hasPassword && <span className="badge sso">{t('users.table.sso')}</span>}
                    </span>
                    <span className="cell-email">{user.email}</span>
                  </td>
                  <td>
                    <div className="group-badges">
                      {user.groups && user.groups.length > 0 ? (
                        user.groups.map((g) => (
                          <span key={g.id} className="badge">
                            {g.name}
                          </span>
                        ))
                      ) : (
                        <span className="muted">{t('users.noGroups')}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`mini-toggle${user.isAdmin ? ' active' : ''}`}
                      title={t('users.table.admin')}
                      aria-label={t('users.table.admin')}
                      aria-pressed={user.isAdmin}
                      onClick={() => void toggleAdmin(user)}
                    >
                      <Icon name="shield" size={14} />
                    </button>
                  </td>
                  <td>
                    <div className="toggle-group">
                      <label
                        className={`mini-toggle${isPushEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.pushNotifications')}
                        onClick={() => togglePushNotifications(user)}
                      >
                        <input type="checkbox" checked={isPushEnabled(user)} onChange={() => {}} />
                        <Icon name="bell" size={14} />
                      </label>
                      <label
                        className={`mini-toggle${isEmailEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.emailNotifications')}
                        onClick={() => toggleEmailNotifications(user)}
                      >
                        <input type="checkbox" checked={isEmailEnabled(user)} onChange={() => {}} />
                        <Icon name="mail" size={14} />
                      </label>
                    </div>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString(i18n.language)}</td>
                  <td className="actions">
                    <button
                      className="icon-button"
                      title={t('users.manageGroups')}
                      aria-label={t('users.manageGroups')}
                      onClick={() => setManagingUser(user)}
                    >
                      <Icon name="users" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title={t('users.password')}
                      aria-label={t('users.password')}
                      onClick={() => handleResetPassword(user)}
                    >
                      <Icon name="key" size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => handleDelete(user)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <button className="secondary" disabled={loadingMore || refreshing} onClick={loadMore}>
            {loadingMore ? t('common.loading') : t('common.loadMore')}
          </button>
        )}
      </div>

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
    <AdminModal title={t('users.manageGroupsFor', { name: user.name })} onClose={onClose} busy={!!busyGroupId}>
      {groups.length === 0 ? (
        <div className="empty">{t('groups.noGroups')}</div>
      ) : (
        <ul className="membership-list">
          {groups.map((group) => {
            const isMember = memberGroupIds.has(group.id)
            return (
              <li key={group.id} className="membership-row">
                <span>{group.name}</span>
                <button
                  className={isMember ? 'danger' : ''}
                  disabled={!!busyGroupId}
                  onClick={() => toggleMembership(group, isMember)}
                >
                  {isMember ? t('common.remove') : t('common.add')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose} disabled={!!busyGroupId}>
          {t('common.close')}
        </button>
      </div>
    </AdminModal>
  )
}
