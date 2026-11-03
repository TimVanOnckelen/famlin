import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminModal } from './AdminModal'
import { avatarColor, initials } from '../avatar'

type Candidate = { id: string; name: string; email: string }

export function AddMembersModal({
  title,
  candidates,
  onAdd,
  onClose,
}: {
  title: string
  candidates: Candidate[]
  onAdd: (userId: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function add(id: string) {
    if (submitting.current) return
    submitting.current = true
    setBusyId(id)
    setError('')
    try {
      await onAdd(id)
      setAdded((current) => new Set([...current, id]))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      submitting.current = false
      setBusyId(null)
    }
  }
  const available = candidates.filter((user) => !added.has(user.id)).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <AdminModal title={title} onClose={onClose} busy={!!busyId}>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {available.length === 0 ? (
        <div className="empty">{t('members.noneAvailable')}</div>
      ) : (
        <ul className="member-cards admin-member-picker" aria-busy={!!busyId}>
          {available.map((user) => (
            <li key={user.id} className="member-card">
              <span className="avatar" style={{ background: avatarColor(user.name) }}>
                {initials(user.name)}
              </span>
              <span className="member-card-info">
                <span className="member-card-name">{user.name}</span>
                <span className="member-card-sub">{user.email}</span>
              </span>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void add(user.id)}
                aria-label={t('members.addNamed', { name: user.name })}
              >
                {t(busyId === user.id ? 'common.loading' : 'common.add')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={!!busyId} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </AdminModal>
  )
}
