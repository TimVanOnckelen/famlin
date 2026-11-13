import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Badge } from '@famlin/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@famlin/ui/table'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ApiError, DiskUsage, IntegrationStatus, IntegrationsStatus, JobStatus, SystemStatus } from '../api/client'
import i18n from '../i18n'

const BACKUP_DOCS_URL = 'https://famlin.app/docs/maintenance#keep-backups-off-the-machine'

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
  if (running)
    return (
      <Badge variant="secondary" className="badge">
        {t('systemStatus.running')}
      </Badge>
    )
  if (ok === null)
    return (
      <Badge variant="secondary" className="badge">
        {t('systemStatus.never')}
      </Badge>
    )
  return <Badge variant={ok ? 'success' : 'destructive'}>{ok ? t('systemStatus.ok') : t('systemStatus.failed')}</Badge>
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
          {disk.low && <Badge variant="destructive">{t('systemStatus.disk.low')}</Badge>}
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
  if (!status)
    badge = (
      <Badge variant="secondary" className="badge">
        {t('common.loading')}
      </Badge>
    )
  else if (!status.configured)
    badge = (
      <Badge variant="secondary" className="badge">
        {t('systemStatus.integrations.notConfigured')}
      </Badge>
    )
  else if (status.ok) badge = <Badge variant="success">{t('systemStatus.ok')}</Badge>
  else
    badge = (
      <Badge variant="destructive">{t(`systemStatus.integrations.errors.${status.error ?? 'unreachable'}`)}</Badge>
    )
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('systemStatus.jobs.job')}</TableHead>
            <TableHead>{t('systemStatus.jobs.lastRun')}</TableHead>
            <TableHead>{t('systemStatus.jobs.result')}</TableHead>
            <TableHead>{t('systemStatus.jobs.lastSuccess')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.job}>
              <TableCell>
                {t(`systemStatus.jobs.names.${job.job}`)}
                {job.lastError && job.lastOk === false && <div className="status-job-error">{job.lastError}</div>}
              </TableCell>
              <TableCell className="muted">{formatDate(job.lastStartedAt) ?? '—'}</TableCell>
              <TableCell>
                <ResultBadge ok={job.lastOk} running={job.running} />
              </TableCell>
              <TableCell className="muted">{formatDate(job.lastSuccessAt) ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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

  if (error && !status)
    return (
      <StateMessage variant="error" className="error">
        {error}
      </StateMessage>
    )
  if (!status)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  const { backups, disk, jobs, migrations, push } = status
  const backupJob = jobs.find((j) => j.job === 'backup')
  const lastBackupBytes = backupJob?.lastOk ? Number(backupJob.lastDetails?.dumpBytes ?? 0) : null
  const mirror = backupJob?.lastOk ? (backupJob.lastDetails?.mirror as { totalBytes?: number } | undefined) : undefined
  const rate = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`)

  return (
    <>
      <PageHeader
        title={t('systemStatus.title')}
        actions={
          <>
            <Button
              variant="secondary"
              className="secondary"
              onClick={() => {
                loadStatus()
                setIntegrations(null)
                loadIntegrations()
              }}
            >
              {t('systemStatus.refresh')}
            </Button>
          </>
        }
      />

      <div className="status-grid">
        <Card className="p-6 gap-4">
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
                  <Badge variant="outline">{t('serverSettings.statusDisabled')}</Badge>{' '}
                  <Link to="/backups">{t('systemStatus.backups.enableInSettings')}</Link>
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
          <p className="muted">
            {t('serverSettings.backupOffsiteHint')}{' '}
            <a href={BACKUP_DOCS_URL} target="_blank" rel="noreferrer">
              {t('serverSettings.backupOffsiteLink')}
            </a>
          </p>
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
            <Button onClick={handleRunBackup} disabled={starting || backups.running}>
              {backups.running ? t('systemStatus.backups.running') : t('systemStatus.backups.runNow')}
            </Button>
            {backupError && <span className="test-err">{backupError}</span>}
          </div>
        </Card>

        <Card className="p-6 gap-4">
          <h3>{t('systemStatus.disk.title')}</h3>
          {disk.uploadsDriver === 's3' ? (
            <>
              <div className="status-row">
                <span>{t('systemStatus.disk.uploads')}</span>
                <Badge variant="secondary" className="badge">
                  S3
                </Badge>
              </div>
              <p className="hint">{t('systemStatus.disk.s3Capacity')}</p>
            </>
          ) : (
            <DiskRow label={t('systemStatus.disk.uploads')} disk={disk.uploads} />
          )}
          {!disk.sameVolume && <DiskRow label={t('systemStatus.disk.backups')} disk={disk.backups} />}
          {disk.sameVolume && <p className="hint">{t('systemStatus.disk.sameVolume')}</p>}
        </Card>

        <Card className="p-6 gap-4">
          <h3>{t('systemStatus.integrations.title')}</h3>
          <IntegrationRow label={t('systemStatus.integrations.smtp')} status={integrations?.smtp} />
          <IntegrationRow label={t('systemStatus.integrations.oidc')} status={integrations?.oidc} />
          <IntegrationRow label={t('systemStatus.integrations.immich')} status={integrations?.immich} />
          <IntegrationRow label={t('systemStatus.integrations.localMedia')} status={integrations?.localMedia} />
        </Card>

        <Card className="p-6 gap-4">
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
        </Card>

        <Card className="p-6 gap-4 status-wide">
          <h3>{t('systemStatus.jobs.title')}</h3>
          <JobsTable jobs={jobs} />
        </Card>

        <Card className="p-6 gap-4 status-wide">
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
              <Badge variant="success">{t('systemStatus.migrations.upToDate')}</Badge>
            ) : (
              <Badge variant="destructive">{migrations.pending.join(', ')}</Badge>
            )}
          </div>
          {migrations.failed.length > 0 && (
            <p className="test-err">{t('systemStatus.migrations.failed', { names: migrations.failed.join(', ') })}</p>
          )}
        </Card>
      </div>
    </>
  )
}
