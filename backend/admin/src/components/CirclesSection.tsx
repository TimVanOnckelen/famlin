import { StateMessage } from '@famlin/ui/common/state-message'
import { InitialAvatar } from '@/components/common/InitialAvatar'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { Textarea } from '@famlin/ui/textarea'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type Circle, type GroupMember } from '../api/client'
import { useAdminDialogs } from './AdminDialogs'
import { AdminModal } from './AdminModal'
import { DialogActions } from '@famlin/ui/dialog'
import { AddMembersModal } from './AddMembersModal'
import { MemberCards } from './MemberCards'
import { Icon } from './Icon'

/**
 * Admin management for a group's Family Circles.
 *
 * Two things here are deliberate and easy to get wrong if this is ever
 * rewritten:
 *
 * 1. This is the ONLY surface that can enumerate a group's circles. The
 *    member-facing API returns just the caller's own circles, because a group
 *    member outside a circle must not learn it exists.
 *
 * 2. Management access is NOT content access. An admin who isn't in a circle
 *    cannot read its posts — not here, not in content moderation, not through
 *    a media URL. That's why deletion leans on the post COUNT rather than
 *    showing what's inside: the number is all an admin outside the circle is
 *    entitled to, and it's enough to make the destruction informed.
 */
export function CirclesSection({ groupId, members }: { groupId: string; members: GroupMember[] }) {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [circles, setCircles] = useState<Circle[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [formError, setFormError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addingToId, setAddingToId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formSubmitting = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setCircles(await api.getGroupCircles(groupId))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [groupId, t])

  // Removing a group member also removes their circle memberships on the server.
  useEffect(() => {
    void load()
  }, [load, members])

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!newName.trim() || formSubmitting.current) return
    formSubmitting.current = true
    setBusy(true)
    setFormError('')
    try {
      const values = { name: newName.trim(), description: newDescription.trim() || null }
      if (editingId) {
        const updated = await api.updateCircle(editingId, values)
        // Update responses contain counts, but not the expanded member list.
        setCircles((current) =>
          current
            .map((circle) => (circle.id === editingId ? { ...circle, ...updated, members: circle.members } : circle))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } else {
        const circle = await api.createCircle(groupId, values)
        setCircles((current) => [...current, { ...circle, members: [] }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setCreating(false)
      setEditingId(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      formSubmitting.current = false
      setBusy(false)
    }
  }

  async function handleDelete(circle: Circle) {
    const message =
      circle.postCount > 0
        ? t('circles.confirmDeleteWithPosts', { name: circle.name, count: circle.postCount })
        : t('circles.confirmDelete', { name: circle.name })
    if (!(await dialogs.confirmAction(message))) return
    setBusy(true)
    try {
      await api.deleteCircle(circle.id, circle.postCount > 0)
      setCircles((current) => current.filter((item) => item.id !== circle.id))
    } catch (err) {
      await dialogs.showMessage(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  async function handleAddMember(circle: Circle, userId: string) {
    const member = members.find((item) => item.id === userId)
    if (!member) throw new Error(t('members.noneAvailable'))
    await api.addCircleMember(circle.id, userId)
    setCircles((current) =>
      current.map((item) =>
        item.id === circle.id
          ? {
              ...item,
              memberCount: item.memberCount + 1,
              members: [...(item.members ?? []), { ...member, joinedAt: new Date().toISOString() }],
            }
          : item
      )
    )
  }

  async function handleRemoveMember(circle: Circle, member: GroupMember) {
    if (!(await dialogs.confirmAction(t('circles.removeMemberConfirm', { name: member.name, circle: circle.name }))))
      return
    setBusy(true)
    try {
      await api.removeCircleMember(circle.id, member.id)
      setCircles((current) =>
        current.map((item) =>
          item.id === circle.id
            ? {
                ...item,
                memberCount: Math.max(0, item.memberCount - 1),
                members: (item.members ?? []).filter((item) => item.id !== member.id),
              }
            : item
        )
      )
    } catch (err) {
      await dialogs.showMessage(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const addingTo = circles.find((circle) => circle.id === addingToId)
  return (
    <>
      <div className="md-section-header">
        <h4>{t('circles.heading', { count: circles.length })}</h4>
        <Button
          variant="link"
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => {
            setEditingId(null)
            setNewName('')
            setNewDescription('')
            setFormError('')
            setCreating(true)
          }}
        >
          {t('circles.create')}
        </Button>
      </div>
      <p className="md-hint">{t('circles.hint')}</p>
      {loadError && (
        <StateMessage variant="error" className="error" role="alert">
          {loadError}
          <Button variant="link" type="button" className="link-button" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </StateMessage>
      )}
      {loading ? (
        <StateMessage variant="loading" className="loading">
          {t('common.loading')}
        </StateMessage>
      ) : !loadError && circles.length === 0 ? (
        <StateMessage variant="empty" className="empty">
          {t('circles.none')}
        </StateMessage>
      ) : (
        <ul className="member-cards">
          {circles.map((circle) => {
            const expanded = expandedId === circle.id
            return (
              <li key={circle.id} className="member-card md-circle-card">
                <div className="md-circle-row">
                  <InitialAvatar name={circle.name} />
                  <span className="member-card-info">
                    <span className="member-card-name">{circle.name}</span>
                    <span className="member-card-sub">
                      {t('circles.memberCount', { count: circle.memberCount })} ·{' '}
                      {t('circles.postCount', { count: circle.postCount })}
                      {circle.description ? ` · ${circle.description}` : ''}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="icon-button"
                    title={t('circles.manageMembers')}
                    aria-label={t('circles.manageMembers')}
                    aria-expanded={expanded}
                    aria-controls={`circle-members-${circle.id}`}
                    onClick={() => setExpandedId(expanded ? null : circle.id)}
                  >
                    <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="icon-button"
                    title={t('circles.addMember')}
                    aria-label={t('circles.addMember')}
                    disabled={busy}
                    onClick={() => setAddingToId(circle.id)}
                  >
                    <Icon name="user-plus" size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="icon-button"
                    title={t('circles.edit')}
                    aria-label={t('circles.edit')}
                    disabled={busy}
                    onClick={() => {
                      setCreating(false)
                      setEditingId(circle.id)
                      setNewName(circle.name)
                      setNewDescription(circle.description ?? '')
                      setFormError('')
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    type="button"
                    className="icon-button danger"
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                    disabled={busy}
                    onClick={() => void handleDelete(circle)}
                  >
                    <Icon name="trash" size={14} />
                  </Button>
                </div>
                {expanded && (
                  <div id={`circle-members-${circle.id}`} className="md-circle-members">
                    {!(circle.members ?? []).length ? (
                      <StateMessage variant="empty" className="empty">
                        {t('circles.noMembers')}
                      </StateMessage>
                    ) : (
                      <MemberCards
                        members={circle.members ?? []}
                        onRemove={(member) => void handleRemoveMember(circle, member)}
                        disabled={busy}
                      />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {(creating || editingId) && (
        <AdminModal
          title={t(editingId ? 'circles.edit' : 'circles.create')}
          onClose={() => {
            setCreating(false)
            setEditingId(null)
          }}
          busy={busy}
        >
          <form onSubmit={handleSave}>
            <label>
              {t('common.name')}
              <Input
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t('circles.namePlaceholder')}
                maxLength={100}
                required
                disabled={busy}
              />
            </label>
            <label>
              {t('common.description')}
              <Textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder={t('circles.descriptionPlaceholder')}
                maxLength={500}
                disabled={busy}
              />
            </label>
            {formError && (
              <StateMessage variant="error" className="error" role="alert">
                {formError}
              </StateMessage>
            )}
            <DialogActions>
              <Button
                variant="secondary"
                type="button"
                className="secondary"
                onClick={() => {
                  setCreating(false)
                  setEditingId(null)
                }}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !newName.trim()}>
                {t(busy ? 'common.loading' : 'common.save')}
              </Button>
            </DialogActions>
          </form>
        </AdminModal>
      )}
      {addingTo && (
        <AddMembersModal
          key={addingTo.id}
          title={`${addingTo.name} · ${t('circles.addMember')}`}
          candidates={members.filter(
            (member) => !(addingTo.members ?? []).some((existing) => existing.id === member.id)
          )}
          onAdd={(id) => handleAddMember(addingTo, id)}
          onClose={() => setAddingToId(null)}
        />
      )}
    </>
  )
}
