import { StateMessage } from '@famlin/ui/common/state-message'
import { InitialAvatar } from '@/components/common/InitialAvatar'
import { Button } from '@famlin/ui/button'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminModal } from './AdminModal'

type Candidate = { id: string; name: string; email: string; avatarUrl: string | null }

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
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
      )}
      {available.length === 0 ? (
        <StateMessage variant="empty" className="empty">
          {t('members.noneAvailable')}
        </StateMessage>
      ) : (
        <ul className="member-cards admin-member-picker" aria-busy={!!busyId}>
          {available.map((user) => (
            <li key={user.id} className="member-card">
              <InitialAvatar name={user.name} avatarUrl={user.avatarUrl} />
              <span className="member-card-info">
                <span className="member-card-name">{user.name}</span>
                <span className="member-card-sub">{user.email}</span>
              </span>
              <Button
                type="button"
                disabled={!!busyId}
                onClick={() => void add(user.id)}
                aria-label={t('members.addNamed', { name: user.name })}
              >
                {t(busyId === user.id ? 'common.loading' : 'common.add')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <Button variant="secondary" type="button" className="secondary" disabled={!!busyId} onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </AdminModal>
  )
}
