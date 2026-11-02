import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type StorageStatus, type StorageLocationStatus } from '../api/client'
import { Icon, type IconName } from './Icon'
import { formatBytes } from './SystemStatusPage'

function StorageCard({
  title,
  icon,
  badge,
  children,
}: {
  title: string
  icon: IconName
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      <div className="settings-card-header">
        <span className="settings-card-icon">
          <Icon name={icon} size={17} />
        </span>
        <div className="settings-card-heading">
          <h3>{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </section>
  )
}

function StorageLocation({
  location,
  fallback = false,
}: {
  location: StorageLocationStatus | null
  fallback?: boolean
}) {
  const { t } = useTranslation()
  const fields = location
    ? [
        [t('storage.driver'), location.driver === 's3' ? 'S3' : 'Local'],
        [t('storage.directory'), location.directory],
        [t('storage.bucket'), location.bucket],
        [t('storage.prefix'), location.driver === 's3' ? location.prefix || '/' : undefined],
        [t('storage.endpoint'), location.endpoint],
        [t('storage.region'), location.region],
      ]
    : []
  return (
    <StorageCard
      title={t(fallback ? 'storage.fallback' : 'storage.primary')}
      icon={fallback ? 'folder' : 'layers'}
      badge={
        <span className={`badge ${!location ? 'off' : location.available ? 'ok' : 'err'}`}>
          {t(!location ? 'storage.notConfigured' : location.available ? 'storage.available' : 'storage.unavailable')}
        </span>
      }
    >
      {location ? (
        <>
          <div className="storage-metrics">
            <div>
              <span>{t('storage.files')}</span>
              <strong>{location.files?.toLocaleString() ?? '—'}</strong>
            </div>
            <div>
              <span>{t('storage.size')}</span>
              <strong>{location.bytes === null ? '—' : formatBytes(location.bytes)}</strong>
            </div>
          </div>
          <dl className="storage-details">
            {fields
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <div className="status-row" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {fallback && (
            <details className="status-details storage-fingerprint">
              <summary>{t('storage.confirmSource')}</summary>
              <code>{location.fingerprint}</code>
            </details>
          )}
        </>
      ) : (
        <p className="hint storage-empty">{t('storage.notConfigured')}</p>
      )}
    </StorageCard>
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
      if (cleanup) setConfirmation('')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  const running = ['running', 'cleaning'].includes(status?.migration?.status ?? '')
  const cleaning = status?.migration?.status === 'cleaning'
  const conflicts = status?.progress.some((row) => row.status === 'conflict' && row.files > 0)
  const canClean =
    !!status?.fallback &&
    !busy &&
    !running &&
    !conflicts &&
    ['verified', 'cleanup_failed', 'cleaned'].includes(status.migration?.status ?? '')
  return (
    <>
      <div className="page-header">
        <h2>{t('storage.title')}</h2>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {!status ? (
        <div className="status-grid storage-grid" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <div className="card storage-loading" key={key}>
              {t('common.loading')}
            </div>
          ))}
        </div>
      ) : (
        <div className="status-grid storage-grid">
          <StorageLocation location={status.primary} />
          <StorageLocation location={status.fallback} fallback />
          <StorageCard
            title={t('storage.migrationTitle')}
            icon="rotate-ccw"
            badge={
              !cleaning && (
                <span
                  className={`badge ${status.migration?.status === 'failed' || conflicts ? 'err' : status.migration?.status === 'verified' ? 'ok' : ''}`}
                >
                  {status.migration ? stateLabel(status.migration.status) : t('storage.idle')}
                </span>
              )
            }
          >
            <p className="hint storage-direction">
              {t('storage.fallback')} <span aria-hidden="true">→</span> {t('storage.primary')}
            </p>
            {status.migration?.error && (
              <p role="alert" className="status-job-error">
                {status.migration.error}
              </p>
            )}
            {status.progress.length > 0 ? (
              <div className="content-table storage-progress-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('storage.state')}</th>
                      <th>{t('storage.files')}</th>
                      <th>{t('storage.size')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.progress.map((row) => (
                      <tr key={row.status}>
                        <td>{stateLabel(row.status)}</td>
                        <td>{row.files.toLocaleString()}</td>
                        <td>{formatBytes(row.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="storage-empty hint">{t('storage.idle')}</p>
            )}
            {status.errors.length > 0 && (
              <details className="status-details">
                <summary>{t('storage.errors', { count: status.errors.length })}</summary>
                <ul>
                  {status.errors.map((row) => (
                    <li key={row.key}>
                      <code>{row.key}</code>
                      <span className="status-job-error"> {row.error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="storage-actions">
              <button disabled={busy || !status.fallback || running} onClick={() => void run(false)}>
                {t('storage.migrate')}
              </button>
            </div>
          </StorageCard>
          {status.fallback && (
            <div className="status-wide">
              <StorageCard
                title={t('storage.cleanup')}
                icon="trash"
                badge={
                  status.migration && ['cleaning', 'cleaned', 'cleanup_failed'].includes(status.migration.status) ? (
                    <span className={`badge ${cleaning ? '' : status.migration.status === 'cleaned' ? 'ok' : 'err'}`}>
                      {stateLabel(status.migration.status)}
                    </span>
                  ) : undefined
                }
              >
                <p className="hint">{t('storage.cleanupHint')}</p>
                {!canClean && <p className="hint">{t('storage.cleanupLocked')}</p>}
                <div className="storage-cleanup-form">
                  <label htmlFor="storage-source-fingerprint">
                    {t('storage.confirmSource')}
                    <input
                      id="storage-source-fingerprint"
                      type="text"
                      value={confirmation}
                      disabled={!canClean}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('storage.confirmPlaceholder')}
                    />
                  </label>
                  <button
                    className="danger"
                    disabled={!canClean || confirmation !== status.fallback.fingerprint}
                    onClick={() => void run(true)}
                  >
                    {t('storage.cleanup')}
                  </button>
                </div>
                <p className="hint storage-cleanup-note">{t('storage.removeFallback')}</p>
              </StorageCard>
            </div>
          )}
          <p className="hint status-wide storage-config-note">
            <Icon name="key" size={15} />
            {t('storage.description')}
          </p>
        </div>
      )}
    </>
  )
}
