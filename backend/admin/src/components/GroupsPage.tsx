import { InitialAvatar } from './common/InitialAvatar'
import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { Badge } from '@famlin/ui/badge'
import { Input } from '@famlin/ui/input'
import { AdminModal } from './AdminModal'
import { AddMembersModal } from './AddMembersModal'
import { MemberCards } from './MemberCards'
import { CheckboxField } from './CheckboxField'
import { useAdminDialogs } from './AdminDialogs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError, Group, GroupMember, Invite, User, PostTypeInfo } from '../api/client'
import i18n from '../i18n'
import { Icon } from './Icon'
import { AddMemberModal } from './AddMemberModal'
import { CirclesSection } from './CirclesSection'
import { Link } from 'react-router-dom'

export function GroupsPage() {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [groups, setGroups] = useState<Group[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [showAddExisting, setShowAddExisting] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [loading, setLoading] = useState(true)

  // Group create/edit modal. `formGroup === null` while closed; a Group with an
  // empty id means "create", otherwise "edit".
  const [formGroup, setFormGroup] = useState<Group | null>(null)

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null

  const loadGroups = async () => {
    const list = await api.getGroups()
    setGroups(list)
    // Keep a valid selection: default to the first group when none is selected.
    setSelectedId((current) => {
      if (current && list.some((g) => g.id === current)) return current
      return list[0]?.id ?? null
    })
    return list
  }

  useEffect(() => {
    Promise.all([loadGroups(), api.getAllUsers().then(setUsers)]).finally(() => setLoading(false))
  }, [])

  const loadMembers = (groupId: string) => {
    setMembersLoading(true)
    api
      .getGroupMembers(groupId)
      .then(setMembers)
      .finally(() => setMembersLoading(false))
  }

  const loadInvites = (groupId: string) => {
    setInvitesLoading(true)
    api
      .getGroupInvites(groupId)
      .then(setInvites)
      .finally(() => setInvitesLoading(false))
  }

  useEffect(() => {
    setShowAddExisting(false)
    if (selectedId) {
      loadMembers(selectedId)
      loadInvites(selectedId)
    } else {
      setMembers([])
      setInvites([])
    }
  }, [selectedId])

  const handleSubmitForm = async (values: {
    name: string
    description: string
    allowedPostTypes: string[]
    chitchatEnabled: boolean
    storiesEnabled: boolean
  }) => {
    if (formGroup && formGroup.id) {
      await api.updateGroup(formGroup.id, values)
    } else {
      const created = await api.createGroup(values)
      setSelectedId(created.id)
    }
    setFormGroup(null)
    await loadGroups()
  }

  const handleDelete = async (group: Group) => {
    if (!(await dialogs.confirmAction(t('groups.deleteConfirm', { name: group.name })))) return
    try {
      await api.deleteGroup(group.id)
      if (selectedId === group.id) setSelectedId(null)
      await loadGroups()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleAddMember = async (userId: string) => {
    if (!selectedGroup) return
    await api.addGroupMember(selectedGroup.id, userId)
    const user = users.find((candidate) => candidate.id === userId)
    if (user)
      setMembers((current) =>
        current.some((member) => member.id === userId)
          ? current
          : [...current, { ...user, joinedAt: new Date().toISOString() }]
      )
    setGroups((current) =>
      current.map((group) =>
        group.id === selectedGroup.id ? { ...group, memberCount: (group.memberCount ?? members.length) + 1 } : group
      )
    )
  }

  const handleRemoveMember = async (member: GroupMember) => {
    if (!selectedGroup) return
    if (!(await dialogs.confirmAction(t('groups.removeMemberConfirm', { name: member.name })))) return
    try {
      await api.removeGroupMember(selectedGroup.id, member.id)
      loadMembers(selectedGroup.id)
      loadGroups()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      await dialogs.showMessage(t('groups.removeMemberError', { error: message }))
    }
  }

  const handleCopyInviteLink = (invite: Invite) => {
    navigator.clipboard.writeText(invite.link)
    setCopiedInviteId(invite.id)
    setTimeout(() => setCopiedInviteId((current) => (current === invite.id ? null : current)), 2000)
  }

  const handleRevokeInvite = async (invite: Invite) => {
    if (!selectedGroup) return
    if (!(await dialogs.confirmAction(t('groups.invites.revokeConfirm')))) return
    try {
      await api.revokeInvite(invite.id)
      loadInvites(selectedGroup.id)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      await dialogs.showMessage(t('groups.invites.revokeError', { error: message }))
    }
  }

  const nonMembers = users.filter((u) => !members.some((m) => m.id === u.id))

  if (loading)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  return (
    <>
      <PageHeader
        title={t('groups.title')}
        actions={
          <>
            <Button onClick={() => setFormGroup({ id: '', name: '', description: '', createdAt: '' })}>
              {t('groups.newGroup')}
            </Button>
          </>
        }
      />

      {groups.length === 0 ? (
        <Card className="p-6 gap-4 empty">{t('groups.noGroups')}</Card>
      ) : (
        <div className="master-detail">
          {/* Master: group list */}
          <aside className="md-list card">
            {groups.map((group) => (
              <Button
                variant="ghost"
                key={group.id}
                className={`h-auto justify-start whitespace-normal rounded-sm px-3 py-3 md-list-item${group.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(group.id)}
              >
                <span className="md-list-item-main">
                  <span className="md-list-item-name">{group.name}</span>
                  {group.description && <span className="md-list-item-desc">{group.description}</span>}
                </span>
                <Badge variant="secondary" className="badge">
                  {t('groups.memberCount', { count: group.memberCount ?? 0 })}
                </Badge>
              </Button>
            ))}
          </aside>

          {/* Detail: selected group */}
          <Card className="md-detail p-6 gap-4">
            {!selectedGroup ? (
              <StateMessage variant="empty" className="empty">
                {t('groups.selectGroupHint')}
              </StateMessage>
            ) : (
              <>
                <div className="md-detail-header">
                  <div>
                    <h3 className="md-detail-title">{selectedGroup.name}</h3>
                    <p className="md-detail-desc">
                      {selectedGroup.description || <span className="muted">{t('groups.noDescription')}</span>}
                    </p>
                  </div>
                  <div className="actions">
                    <Button variant="secondary" className="secondary" onClick={() => setFormGroup(selectedGroup)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="destructive" className="danger" onClick={() => handleDelete(selectedGroup)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>

                <div className="md-section-header">
                  <h4>{t('groups.invites.title')}</h4>
                  <Button variant="link" type="button" className="link-button" onClick={() => setShowAddMember(true)}>
                    {t('members.addMember')}
                  </Button>
                </div>
                <p className="hint">{t('groups.invites.hint')}</p>

                {invitesLoading ? (
                  <StateMessage variant="loading" className="loading">
                    {t('common.loading')}
                  </StateMessage>
                ) : invites.length === 0 ? (
                  <StateMessage variant="empty" className="empty">
                    {t('groups.invites.noInvites')}
                  </StateMessage>
                ) : (
                  <ul className="member-cards">
                    {invites.map((invite) => {
                      const usedBy = invite.usedBy
                        ? (users.find((user) => user.id === invite.usedBy?.id) ?? invite.usedBy)
                        : null
                      const expired = !invite.usedAt && !!invite.expiresAt && new Date(invite.expiresAt) < new Date()
                      const status = invite.usedAt
                        ? t('groups.invites.statusUsedBy', { name: usedBy?.name ?? t('common.unknown') })
                        : expired
                          ? t('groups.invites.statusExpired')
                          : t('groups.invites.statusActive')
                      const revocable = !invite.usedAt && !expired

                      return (
                        <li key={invite.id} className="member-card">
                          <span className="member-card-info">
                            <span className="member-card-name">
                              {invite.email || t('groups.invites.anyEmail')}
                              <span className="inline-flex items-center gap-2">
                                {usedBy && (
                                  <InitialAvatar name={usedBy.name} avatarUrl={usedBy.avatarUrl} className="size-6" />
                                )}
                                <Badge variant={revocable ? 'secondary' : 'default'}>{status}</Badge>
                              </span>
                            </span>
                            <span className="member-card-sub">
                              {invite.expiresAt
                                ? t('groups.invites.expiresOn', {
                                    date: new Date(invite.expiresAt).toLocaleDateString(i18n.language),
                                  })
                                : t('groups.invites.neverExpires')}
                              {' · '}
                              {t('groups.invites.createdOn', {
                                date: new Date(invite.createdAt).toLocaleDateString(i18n.language),
                              })}
                            </span>
                          </span>
                          <Button
                            variant="secondary"
                            type="button"
                            className="secondary"
                            onClick={() => handleCopyInviteLink(invite)}
                          >
                            {copiedInviteId === invite.id
                              ? t('groups.invites.linkCopied')
                              : t('groups.invites.copyLink')}
                          </Button>
                          {revocable && (
                            <Button
                              variant="destructive"
                              size="icon"
                              className="icon-button danger"
                              title={t('groups.invites.revoke')}
                              aria-label={t('groups.invites.revoke')}
                              onClick={() => handleRevokeInvite(invite)}
                            >
                              <Icon name="x" size={14} />
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* Circles sit directly under the member list: they're a
                    narrowing of exactly those people, so managing them next
                    to membership is where an admin will look. */}
                <CirclesSection key={selectedGroup.id} groupId={selectedGroup.id} members={members} />

                <div className="md-section-header">
                  <h4>{t('groups.memberCount', { count: members.length })}</h4>
                  <Button variant="link" type="button" className="link-button" onClick={() => setShowAddExisting(true)}>
                    {t('groups.addExistingUser')}
                  </Button>
                </div>

                {membersLoading ? (
                  <StateMessage variant="loading" className="loading">
                    {t('common.loading')}
                  </StateMessage>
                ) : members.length === 0 ? (
                  <StateMessage variant="empty" className="empty">
                    {t('groups.noMembers')}
                  </StateMessage>
                ) : (
                  <MemberCards members={members} onRemove={handleRemoveMember} />
                )}

                <div className="md-section-header">
                  <h4>{t('groups.photos.title')}</h4>
                </div>
                <p className="hint">
                  {t('groups.photos.moved')}{' '}
                  <Link to="/integrations/immich/families">{t('integrations.names.immich')}</Link>
                  {' · '}
                  <Link to="/integrations/local/families">{t('integrations.names.local')}</Link>
                </p>
              </>
            )}
          </Card>
        </div>
      )}

      {showAddExisting && selectedGroup && !membersLoading && (
        <AddMembersModal
          key={selectedGroup.id}
          title={`${selectedGroup.name} · ${t('groups.addMember')}`}
          candidates={nonMembers}
          onAdd={handleAddMember}
          onClose={() => setShowAddExisting(false)}
        />
      )}
      {formGroup && <GroupFormModal group={formGroup} onClose={() => setFormGroup(null)} onSubmit={handleSubmitForm} />}

      {showAddMember && selectedGroup && (
        <AddMemberModal
          defaultGroupId={selectedGroup.id}
          onClose={() => setShowAddMember(false)}
          onCreated={() => {
            loadInvites(selectedGroup.id)
            loadMembers(selectedGroup.id)
            loadGroups()
          }}
        />
      )}
    </>
  )
}

interface GroupFormModalProps {
  group: Group
  onClose: () => void
  onSubmit: (values: {
    name: string
    description: string
    allowedPostTypes: string[]
    chitchatEnabled: boolean
    storiesEnabled: boolean
  }) => Promise<void>
}

function GroupFormModal({ group, onClose, onSubmit }: GroupFormModalProps) {
  const { t } = useTranslation()
  const isEdit = !!group.id
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description || '')
  const [chitchatEnabled, setChitchatEnabled] = useState(group.chitchatEnabled ?? false)
  // Unlike chat, stories default to on for a new group.
  const [storiesEnabled, setStoriesEnabled] = useState(group.storiesEnabled ?? true)
  const [saving, setSaving] = useState(false)

  const [postTypes, setPostTypes] = useState<PostTypeInfo[]>([])
  const [loadingPostTypes, setLoadingPostTypes] = useState(true)
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set())
  // Guards against re-seeding checkedTypes if this effect somehow re-ran —
  // the initial checked set is derived once from the group's stored value.
  const initializedTypes = useRef(false)

  useEffect(() => {
    api
      .getPostTypes()
      .then(({ items }) => {
        setPostTypes(items)
        if (!initializedTypes.current) {
          initializedTypes.current = true
          const stored = group.allowedPostTypes
          // Empty/absent stored array = "all allowed" (default), same
          // convention as allowedEmails — every box starts checked.
          setCheckedTypes(!stored || stored.length === 0 ? new Set(items.map((pt) => pt.id)) : new Set(stored))
        }
      })
      .finally(() => setLoadingPostTypes(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleType = (id: string) => {
    setCheckedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const noTypesSelected = checkedTypes.size === 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (noTypesSelected) return
    setSaving(true)
    try {
      // All boxes checked persists as [] so post types registered later are
      // automatically allowed; a partial selection persists the explicit list.
      const allowedPostTypes = checkedTypes.size === postTypes.length ? [] : Array.from(checkedTypes)
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        allowedPostTypes,
        chitchatEnabled,
        storiesEnabled,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminModal title={isEdit ? t('groups.editGroup') : t('groups.newGroup')} onClose={onClose} busy={saving}>
      <form onSubmit={submit}>
        <label>
          {t('groups.form.name')}
          <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          {t('groups.form.description')}
          <Input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div>
          <span className="hint" style={{ marginTop: 0 }}>
            {t('groups.form.allowedPostTypes')}
          </span>
          {loadingPostTypes ? (
            <StateMessage variant="loading" className="loading">
              {t('common.loading')}
            </StateMessage>
          ) : (
            <ul className="membership-list">
              {postTypes.map((pt) => (
                <li key={pt.id} className="membership-row">
                  <CheckboxField
                    label={t(`postTypes.${pt.id}`, { defaultValue: pt.id })}
                    checked={checkedTypes.has(pt.id)}
                    onChange={() => toggleType(pt.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="hint">{t('groups.form.allowedPostTypesHint')}</p>
          {noTypesSelected && !loadingPostTypes && (
            <StateMessage variant="error" className="error">
              {t('groups.form.allowedPostTypesError')}
            </StateMessage>
          )}
        </div>

        <CheckboxField
          label={t('groups.form.chitchatEnabled')}
          hint={t('groups.form.chitchatEnabledHint')}
          checked={chitchatEnabled}
          onChange={setChitchatEnabled}
        />

        <CheckboxField
          label={t('groups.form.storiesEnabled')}
          hint={t('groups.form.storiesEnabledHint')}
          checked={storiesEnabled}
          onChange={setStoriesEnabled}
        />

        <div className="modal-actions">
          <Button variant="secondary" type="button" className="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !name.trim() || loadingPostTypes || noTypesSelected}>
            {isEdit ? t('groups.save') : t('groups.add')}
          </Button>
        </div>
      </form>
    </AdminModal>
  )
}
