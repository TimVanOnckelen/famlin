import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ApiError, DiskUsage, IntegrationStatus, IntegrationsStatus, JobStatus, SystemStatus } from '../api/client'
import i18n from '../i18n'

// While a backup runs, re-poll the status this often to pick up its outcome.
const RUNNING_POLL_MS = 3000

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString(i18n.language) : null
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function ResultBadge({ ok, running }: { ok: boolean | null; running?: boolean }) {
  const { t } = useTranslation()
  if (running) return <span className="badge">{t('systemStatus.running')}</span>
  if (ok === null) return <span className="badge">{t('systemStatus.never')}</span>
  return <span className={`badge ${ok ? 'ok' : 'err'}`}>{ok ? t('systemStatus.ok') : t('systemStatus.failed')}</span>
}

function DiskRow({ label, disk }: { label: string; disk: DiskUsage | null }) {
  const { t } = useTranslation()
  if (!disk) {
    return (
      <div className="status-row">
        <span>{label}</span>
        <span className="muted">{t('systemStatus.disk.unavailable')}</span>
      </div>
    )
  }
  const usedPct = disk.totalBytes > 0 ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) : 0
  return (
    <div className="status-disk">
      <div className="status-row">
        <span>
          {label} <span className="muted">{disk.path}</span>
        </span>
        <span>
          {t('systemStatus.disk.free', { free: formatBytes(disk.freeBytes), total: formatBytes(disk.totalBytes) })}{' '}
          {disk.low && <span className="badge err">{t('systemStatus.disk.low')}</span>}
        </span>
      </div>
      <div className={`disk-bar${disk.low ? ' low' : ''}`} aria-hidden>
        <span style={{ width: `${usedPct}%` }} />
      </div>
    </div>
  )
}

function IntegrationRow({ label, status }: { label: string; status: IntegrationStatus | undefined }) {
  const { t } = useTranslation()
  let badge
  if (!status) badge = <span className="badge">{t('common.loading')}</span>
  else if (!status.configured) badge = <span className="badge">{t('systemStatus.integrations.notConfigured')}</span>
  else if (status.ok) badge = <span className="badge ok">{t('systemStatus.ok')}</span>
  else
    badge = <span className="badge err">{t(`systemStatus.integrations.errors.${status.error ?? 'unreachable'}`)}</span>
  return (
    <div className="status-row">
      <span>{label}</span>
      {badge}
    </div>
  )
}

function JobsTable({ jobs }: { jobs: JobStatus[] }) {
  const { t } = useTranslation()
  return (
    <div className="content-table">
      <table>
        <thead>
          <tr>
            <th>{t('systemStatus.jobs.job')}</th>
            <th>{t('systemStatus.jobs.lastRun')}</th>
            <th>{t('systemStatus.jobs.result')}</th>
            <th>{t('systemStatus.jobs.lastSuccess')}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job}>
              <td>
                {t(`systemStatus.jobs.names.${job.job}`)}
                {job.lastError && job.lastOk === false && <div className="status-job-error">{job.lastError}</div>}
              </td>
              <td className="muted">{formatDate(job.lastStartedAt) ?? '—'}</td>
              <td>
                <ResultBadge ok={job.lastOk} running={job.running} />
              </td>
              <td className="muted">{formatDate(job.lastSuccessAt) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SystemStatusPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const loadStatus = useCallback(() => {
    api
      .getSystemStatus()
      .then((s) => {
        setStatus(s)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [])

  const loadIntegrations = useCallback(() => {
    api
      .getIntegrationsStatus()
      .then(setIntegrations)
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadStatus()
    loadIntegrations()
  }, [loadStatus, loadIntegrations])

  const backupRunning = !!status?.backups.running
  useEffect(() => {
    if (!backupRunning) return
    const timer = setInterval(loadStatus, RUNNING_POLL_MS)
    return () => clearInterval(timer)
  }, [backupRunning, loadStatus])

  const handleRunBackup = async () => {
    setStarting(true)
    setBackupError(null)
    try {
      await api.runBackup()
    } catch (err) {
      // 409: one is already running — the refresh below shows it.
      if (!(err instanceof ApiError && err.status === 409)) setBackupError((err as Error).message)
    } finally {
      setStarting(false)
      loadStatus()
    }
  }

  if (error && !status) return <div className="error">{error}</div>
  if (!status) return <div className="loading">{t('common.loading')}</div>

  const { backups, disk, jobs, migrations, push } = status
  const backupJob = jobs.find((j) => j.job === 'backup')
  const lastBackupBytes = backupJob?.lastOk ? Number(backupJob.lastDetails?.dumpBytes ?? 0) : null
  const mirror = backupJob?.lastOk ? (backupJob.lastDetails?.mirror as { totalBytes?: number } | undefined) : undefined
  const rate = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`)

  return (
    <>
      <div className="page-header">
        <h2>{t('systemStatus.title')}</h2>
        <button
          className="secondary"
          onClick={() => {
            loadStatus()
            setIntegrations(null)
            loadIntegrations()
          }}
        >
          {t('systemStatus.refresh')}
        </button>
      </div>

      <div className="status-grid">
        <section className="card">
          <h3>{t('systemStatus.backups.title')}</h3>
          <div className="status-row">
            <span>{t('systemStatus.backups.schedule')}</span>
            <span>
              {backups.enabled ? (
                t(`systemStatus.backups.scheduleValue.${backups.schedule}`, {
                  time: hourLabel(backups.hour),
                  count: backups.retention,
                })
              ) : (
                <>
                  <span className="badge off">{t('serverSettings.statusDisabled')}</span>{' '}
                  <Link to="/settings">{t('systemStatus.backups.enableInSettings')}</Link>
                </>
              )}
            </span>
          </div>
          <div className="status-row">
            <span>{t('systemStatus.backups.lastBackup')}</span>
            <span>
              {formatDate(backupJob?.lastStartedAt ?? null) ?? '—'}{' '}
              <ResultBadge ok={backupJob?.lastOk ?? null} running={backups.running} />
            </span>
          </div>
          {backupJob?.lastOk === false && backupJob.lastError && <p className="test-err">{backupJob.lastError}</p>}
          {lastBackupBytes !== null && (
            <div className="status-row">
              <span>{t('systemStatus.backups.size')}</span>
              <span>
                {t('systemStatus.backups.sizeValue', {
                  dump: formatBytes(lastBackupBytes),
                  mirror: formatBytes(mirror?.totalBytes ?? 0),
                })}
              </span>
            </div>
          )}
          {backups.nextRunAt && (
            <div className="status-row">
              <span>{t('systemStatus.backups.nextRun')}</span>
              <span>{formatDate(backups.nextRunAt)}</span>
            </div>
          )}
          <div className="status-row">
            <span>{t('systemStatus.backups.location')}</span>
            <span className="muted">{backups.dir}</span>
          </div>
          {backups.dirIsMount === false && <p className="test-err">{t('systemStatus.backups.notMounted')}</p>}
          {backups.dumps.length > 0 && (
            <details className="status-details">
              <summary>{t('systemStatus.backups.dumps', { count: backups.dumps.length })}</summary>
              <ul>
                {backups.dumps.map((d) => (
                  <li key={d.file}>
                    <code>{d.file}</code> <span className="muted">{formatBytes(d.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="settings-test-row">
            <button onClick={handleRunBackup} disabled={starting || backups.running}>
              {backups.running ? t('systemStatus.backups.running') : t('systemStatus.backups.runNow')}
            </button>
            {backupError && <span className="test-err">{backupError}</span>}
          </div>
        </section>

        <section className="card">
          <h3>{t('systemStatus.disk.title')}</h3>
          {disk.uploadsDriver === 's3' ? (
            <>
              <div className="status-row">
                <span>{t('systemStatus.disk.uploads')}</span>
                <span className="badge">S3</span>
              </div>
              <p className="hint">{t('systemStatus.disk.s3Capacity')}</p>
            </>
          ) : (
            <DiskRow label={t('systemStatus.disk.uploads')} disk={disk.uploads} />
          )}
          {!disk.sameVolume && <DiskRow label={t('systemStatus.disk.backups')} disk={disk.backups} />}
          {disk.sameVolume && <p className="hint">{t('systemStatus.disk.sameVolume')}</p>}
        </section>

        <section className="card">
          <h3>{t('systemStatus.integrations.title')}</h3>
          <IntegrationRow label={t('systemStatus.integrations.smtp')} status={integrations?.smtp} />
          <IntegrationRow label={t('systemStatus.integrations.oidc')} status={integrations?.oidc} />
          <IntegrationRow label={t('systemStatus.integrations.immich')} status={integrations?.immich} />
          <IntegrationRow label={t('systemStatus.integrations.localMedia')} status={integrations?.localMedia} />
        </section>

        <section className="card">
          <h3>{t('systemStatus.push.title')}</h3>
          <div className="status-row">
            <span>{t('systemStatus.push.last24h')}</span>
            <span>
              {t('systemStatus.push.summary', {
                delivered: push.last24h.delivered,
                failed: push.last24h.failed,
                rate: rate(push.last24h.failureRate),
              })}
            </span>
          </div>
          <div className="status-row">
            <span>{t('systemStatus.push.last7d')}</span>
            <span>
              {t('systemStatus.push.summary', {
                delivered: push.last7d.delivered,
                failed: push.last7d.failed,
                rate: rate(push.last7d.failureRate),
              })}
            </span>
          </div>
          {push.unhealthy && <p className="test-err">{t('systemStatus.push.unhealthy')}</p>}
          <Link to="/push-log">{t('systemStatus.push.viewLog')}</Link>
        </section>

        <section className="card status-wide">
          <h3>{t('systemStatus.jobs.title')}</h3>
          <JobsTable jobs={jobs} />
        </section>

        <section className="card status-wide">
          <h3>{t('systemStatus.migrations.title')}</h3>
          <div className="status-row">
            <span>{t('systemStatus.migrations.latest')}</span>
            <code>{migrations.latestApplied ?? '—'}</code>
          </div>
          <div className="status-row">
            <span>{t('systemStatus.migrations.applied')}</span>
            <span>{migrations.appliedCount}</span>
          </div>
          <div className="status-row">
            <span>{t('systemStatus.migrations.pending')}</span>
            {migrations.pending === null ? (
              <span className="muted">{t('systemStatus.migrations.unknown')}</span>
            ) : migrations.pending.length === 0 ? (
              <span className="badge ok">{t('systemStatus.migrations.upToDate')}</span>
            ) : (
              <span className="badge err">{migrations.pending.join(', ')}</span>
            )}
          </div>
          {migrations.failed.length > 0 && (
            <p className="test-err">{t('systemStatus.migrations.failed', { names: migrations.failed.join(', ') })}</p>
          )}
        </section>
      </div>
    </>
  )
}
