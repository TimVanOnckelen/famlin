import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type StorageStatus, type StorageLocationStatus } from '../api/client'

function StorageLocation({ location }: { location: StorageLocationStatus | null }) {
  const { t } = useTranslation()
  if (!location) return <p>{t('storage.notConfigured')}</p>
  const fields = [
    [t('storage.driver'), location.driver],
    [t('storage.directory'), location.directory],
    [t('storage.bucket'), location.bucket],
    [t('storage.prefix'), location.prefix || (location.driver === 's3' ? '/' : undefined)],
    [t('storage.endpoint'), location.endpoint],
    [t('storage.region'), location.region],
    [t('storage.availability'), location.available ? t('storage.available') : t('storage.unavailable')],
    [t('storage.files'), location.files?.toLocaleString()],
    [t('storage.bytes'), location.bytes?.toLocaleString()],
    [t('storage.confirmSource'), location.fingerprint],
  ]
  return (
    <dl>
      {fields
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd style={{ overflowWrap: 'anywhere' }}>{value}</dd>
          </div>
        ))}
    </dl>
  )
}

export function StoragePage() {
  const { t } = useTranslation()
  const states = t('storage.states', { returnObjects: true })
  const stateLabel = (state: string) => states[state as keyof typeof states] ?? state
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () =>
      api
        .getStorage()
        .then((value) => {
          if (active) setStatus(value)
        })
        .catch((err) => {
          if (active) setError(String(err))
        })
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const run = async (cleanup: boolean) => {
    setBusy(true)
    setError('')
    try {
      if (cleanup) await api.cleanupStorage(confirmation)
      else await api.migrateStorage()
      setStatus(await api.getStorage())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <h1>{t('storage.title')}</h1>
      <p>{t('storage.description')}</p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {status && (
        <>
          <div className="card">
            <h2>{t('storage.primary')}</h2>
            <StorageLocation location={status.primary} />
          </div>
          <div className="card">
            <h2>{t('storage.fallback')}</h2>
            <StorageLocation location={status.fallback} />
          </div>
          <h2>{t('storage.progress')}</h2>
          <p>{status.migration ? stateLabel(status.migration.status) : t('storage.idle')}</p>
          {status.migration?.error && <p role="alert">{status.migration.error}</p>}
          <table>
            <thead>
              <tr>
                <th>{t('storage.state')}</th>
                <th>{t('storage.files')}</th>
                <th>{t('storage.bytes')}</th>
              </tr>
            </thead>
            <tbody>
              {status.progress.map((row) => (
                <tr key={row.status}>
                  <td>{stateLabel(row.status)}</td>
                  <td>{row.files}</td>
                  <td>{row.bytes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul>
            {status.errors.map((row) => (
              <li key={row.key}>
                {row.key}: {row.error}
              </li>
            ))}
          </ul>
          <button
            disabled={busy || !status.fallback || ['running', 'cleaning'].includes(status.migration?.status ?? '')}
            onClick={() => void run(false)}
          >
            {t('storage.migrate')}
          </button>
          <h2>{t('storage.cleanup')}</h2>
          <p>{t('storage.cleanupHint')}</p>
          <label>
            {t('storage.confirmSource')}
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          <button
            className="danger"
            disabled={
              busy ||
              !status.fallback ||
              confirmation !== status.fallback.fingerprint ||
              status.progress.some((row) => row.status === 'conflict' && row.files > 0) ||
              !['verified', 'cleanup_failed', 'cleaned'].includes(status.migration?.status ?? '')
            }
            onClick={() => void run(true)}
          >
            {t('storage.cleanup')}
          </button>
          <p>{t('storage.removeFallback')}</p>
        </>
      )}
    </div>
  )
}
