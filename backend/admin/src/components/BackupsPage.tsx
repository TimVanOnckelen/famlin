import { PageHeader } from '@famlin/ui/common/page-header'
import { SectionCard } from '@famlin/ui/common/section-card'
import { SettingToggle } from '@famlin/ui/common/setting-toggle'
import { SelectField } from '@famlin/ui/common/select-field'
import { StateMessage } from '@famlin/ui/common/state-message'
import { ConfirmDialog } from '@famlin/ui/common/confirm-dialog'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@famlin/ui/table'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, type BackupsOverview, type ServerSettings, type VolumeBackup } from '../api/client'
import { AdminModal } from './AdminModal'
import { Icon } from './Icon'
import { formatBytes } from './SystemStatusPage'

const BACKUP_DOCS_URL = 'https://famlin.app/docs/maintenance#restoring-a-backup'
const OFFSITE_DOCS_URL = 'https://famlin.app/docs/maintenance#keep-backups-off-the-machine'
// Read by App on the next load: the restore signed everyone out.
export const LOGIN_NOTICE_KEY = 'famlin_admin_login_notice'

type ScheduleFields = Pick<
  ServerSettings,
  'backupEnabled' | 'backupIncludeMedia' | 'backupSchedule' | 'backupHour' | 'backupRetention'
>

const SCHEDULE_KEYS: (keyof ScheduleFields)[] = [
  'backupEnabled',
  'backupIncludeMedia',
  'backupSchedule',
  'backupHour',
  'backupRetention',
]

function pickSchedule(settings: ServerSettings): ScheduleFields {
  return Object.fromEntries(SCHEDULE_KEYS.map((key) => [key, settings[key]])) as unknown as ScheduleFields
}

// Everything backup-related in one place (issue #461): the backups in the
// server's backups volume (download, delete, restore onto this server), a
// manual "back up now", the schedule, and the on-demand download.
export function BackupsPage() {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<BackupsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [schedule, setSchedule] = useState<ScheduleFields | null>(null)
  const [savedSchedule, setSavedSchedule] = useState<ScheduleFields | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleSaved, setScheduleSaved] = useState(false)

  const [exportIncludeMedia, setExportIncludeMedia] = useState(true)
  const [exportStarted, setExportStarted] = useState(false)

  // Until v1.0.0 every run also writes a pg_dump with the same timestamp as
  // its zip; those are hidden behind a toggle so each run reads as one row.
  const [showDumps, setShowDumps] = useState(false)
  const [toDelete, setToDelete] = useState<VolumeBackup | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toRestore, setToRestore] = useState<VolumeBackup | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(() => {
    return api
      .getBackups()
      .then((data) => {
        setOverview(data)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
    api
      .getSettings()
      .then((settings) => {
        setSchedule(pickSchedule(settings))
        setSavedSchedule(pickSchedule(settings))
      })
      .catch((err) => setError(err.message))
  }, [load])

  // A running backup: refresh until it shows up in the list.
  useEffect(() => {
    if (!overview?.backupRunning) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [overview?.backupRunning, load])

  // A running restore (this tab started it, or the page was reloaded during
  // one): poll the public status, then sign out once it's done — it ended
  // every session, this one included.
  useEffect(() => {
    if (!restoring && !overview?.restore.running) return
    const timer = setInterval(async () => {
      try {
        const status = await api.getRestoreStatus()
        if (status.running) return
        clearInterval(timer)
        if (status.ok) {
          try {
            sessionStorage.setItem(LOGIN_NOTICE_KEY, t('backups.restoreDoneNotice'))
          } catch {
            // ignore
          }
          localStorage.removeItem('famlin_admin_token')
          window.location.assign('/admin/')
        } else {
          setRestoring(false)
          setActionError(t(`backups.restoreError.${status.error ?? 'restoreFailed'}`))
          load()
        }
      } catch {
        // The server may be briefly unreachable; keep polling.
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [restoring, overview?.restore.running, load, t])

  const backUpNow = async () => {
    setStarting(true)
    setActionError(null)
    try {
      await api.runBackup()
      await load()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await api.deleteBackup(toDelete.name)
      setToDelete(null)
      await load()
    } catch (err) {
      setActionError((err as Error).message)
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const startRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!toRestore) return
    setRestoreError(null)
    try {
      await api.restoreBackupOnServer(toRestore.name, confirmText)
      setToRestore(null)
      setRestoring(true)
    } catch (err) {
      setRestoreError((err as Error).message)
    }
  }

  const saveSchedule = async () => {
    if (!schedule) return
    setSavingSchedule(true)
    setActionError(null)
    try {
      const updated = await api.updateSettings(schedule)
      setSchedule(pickSchedule(updated))
      setSavedSchedule(pickSchedule(updated))
      setScheduleSaved(true)
      setTimeout(() => setScheduleSaved(false), 3000)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setSavingSchedule(false)
    }
  }

  const download = async (file: string) => {
    setActionError(null)
    try {
      await api.downloadBackup(file)
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  const downloadExport = async () => {
    setActionError(null)
    setExportStarted(false)
    try {
      await api.downloadExport(exportIncludeMedia)
      setExportStarted(true)
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  if (restoring || overview?.restore.running) {
    return (
      <div className="backups-restoring" role="status" aria-live="polite">
        <Icon name="clock" size={32} />
        <h1>{t('backups.restoringTitle')}</h1>
        <p>{t('backups.restoringBody')}</p>
      </div>
    )
  }

  if (error && !overview) {
    return (
      <StateMessage variant="error" className="error">
        {error}
      </StateMessage>
    )
  }
  if (!overview || !schedule) {
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )
  }

  const scheduleDirty = JSON.stringify(schedule) !== JSON.stringify(savedSchedule)
  const archiveTimes = new Set(overview.backups.filter((b) => b.type === 'archive').map((b) => b.createdAt))
  const pairedDumps = overview.backups.filter((b) => b.type === 'dump' && archiveTimes.has(b.createdAt))
  const visibleBackups = showDumps ? overview.backups : overview.backups.filter((b) => !pairedDumps.includes(b))
  const mediaLabel = (backup: VolumeBackup) => {
    if (backup.type === 'dump' || backup.mediaLocation === 'mirror') return t('setup.restoreMediaMirror')
    if (backup.mediaLocation === 'archive') return t('setup.restoreMediaArchive')
    return t('setup.restoreMediaStorage')
  }
  const restoreBlockedReason = (backup: VolumeBackup) => {
    if (!backup.valid) return t('setup.restoreUnreadable')
    if (backup.type === 'archive' && !backup.credentials) return t('backups.olderExportHint')
    return null
  }

  return (
    <>
      <PageHeader
        title={t('backups.title')}
        actions={
          <Button onClick={backUpNow} disabled={starting || overview.backupRunning}>
            {overview.backupRunning || starting ? t('backups.running') : t('backups.backUpNow')}
          </Button>
        }
      />

      {actionError && (
        <StateMessage variant="error" className="error" role="alert">
          {actionError}
        </StateMessage>
      )}

      <div className="backups-page">
        <SectionCard
          title={t('backups.listTitle')}
          icon={<Icon name="clock" size={20} />}
          description={t('backups.listDesc')}
        >
          {overview.backups.length === 0 ? (
            <p className="muted">{t('backups.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('backups.table.date')}</TableHead>
                  <TableHead>{t('backups.table.type')}</TableHead>
                  <TableHead>{t('backups.table.size')}</TableHead>
                  <TableHead>{t('backups.table.photos')}</TableHead>
                  <TableHead>{t('backups.table.version')}</TableHead>
                  <TableHead className="text-right">{t('backups.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleBackups.map((backup) => {
                  const blocked = restoreBlockedReason(backup)
                  return (
                    <TableRow key={backup.name}>
                      <TableCell>
                        <div className="backups-date">
                          <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
                          {backup.safety && <Badge variant="accent">{t('backups.safetyBadge')}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={backup.type === 'dump' ? 'outline' : 'secondary'}>
                          {t(backup.type === 'dump' ? 'setup.restoreTypeDump' : 'setup.restoreTypeArchive')}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatBytes(backup.size)}</TableCell>
                      <TableCell className="muted">{backup.valid ? mediaLabel(backup) : '—'}</TableCell>
                      <TableCell className="muted">{backup.serverVersion ?? '—'}</TableCell>
                      <TableCell>
                        <div className="backups-actions">
                          <Button variant="ghost" size="sm" onClick={() => download(backup.name)}>
                            {t('backups.download')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!blocked || overview.backupRunning}
                            title={blocked ?? undefined}
                            onClick={() => {
                              setConfirmText('')
                              setRestoreError(null)
                              setToRestore(backup)
                            }}
                          >
                            {t('backups.restore')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={overview.backupRunning}
                            onClick={() => setToDelete(backup)}
                          >
                            {t('backups.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          {pairedDumps.length > 0 && (
            <div className="backups-dumps-toggle">
              <Button variant="link" type="button" onClick={() => setShowDumps(!showDumps)}>
                {showDumps ? t('backups.hideDumps') : t('backups.showDumps', { count: pairedDumps.length })}
              </Button>
              {showDumps && <span className="hint">{t('backups.dumpsNote')}</span>}
            </div>
          )}
          <p className="hint">
            {t('serverSettings.backupOffsiteHint')}{' '}
            <a href={OFFSITE_DOCS_URL} target="_blank" rel="noreferrer">
              {t('serverSettings.backupOffsiteLink')}
            </a>
          </p>
        </SectionCard>

        <SectionCard
          title={t('backups.scheduleTitle')}
          icon={<Icon name="clock" size={20} />}
          description={t('serverSettings.backupsDesc')}
        >
          <SettingToggle
            title={t('serverSettings.backupEnabled')}
            hint={t('serverSettings.backupEnabledHint')}
            checked={schedule.backupEnabled}
            onCheckedChange={(checked) => setSchedule({ ...schedule, backupEnabled: checked })}
          />
          <SettingToggle
            title={t('serverSettings.backupIncludeMedia')}
            hint={t('serverSettings.backupIncludeMediaHint')}
            checked={schedule.backupIncludeMedia}
            onCheckedChange={(checked) => setSchedule({ ...schedule, backupIncludeMedia: checked })}
          />
          <div className="row">
            <label style={{ flex: 1 }}>
              {t('serverSettings.backupSchedule')}
              <SelectField
                value={schedule.backupSchedule}
                onValueChange={(value) =>
                  setSchedule({ ...schedule, backupSchedule: value as ServerSettings['backupSchedule'] })
                }
                items={[
                  { value: 'daily', label: <>{t('serverSettings.backupScheduleDaily')}</> },
                  { value: 'weekly', label: <>{t('serverSettings.backupScheduleWeekly')}</> },
                ]}
              />
            </label>
            <label style={{ flex: 1 }}>
              {t('serverSettings.backupHour')}
              <SelectField
                value={schedule.backupHour}
                onValueChange={(value) => setSchedule({ ...schedule, backupHour: Number(value) })}
                items={Array.from({ length: 24 }, (_, hour) => ({
                  value: hour,
                  label: <>{`${String(hour).padStart(2, '0')}:00`}</>,
                }))}
              />
            </label>
            <label style={{ flex: 1 }}>
              {t('serverSettings.backupRetention')}
              <Input
                type="number"
                min={1}
                max={365}
                value={schedule.backupRetention}
                onChange={(e) =>
                  setSchedule({ ...schedule, backupRetention: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </label>
          </div>
          <p className="hint">{t('serverSettings.backupHint')}</p>
          <div className="backups-save-row">
            <Button onClick={saveSchedule} disabled={!scheduleDirty || savingSchedule}>
              {savingSchedule ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
            </Button>
            {scheduleSaved && <span className="hint">{t('backups.scheduleSaved')}</span>}
            <Link to="/status" className="hint">
              {t('serverSettings.backupStatusLink')}
            </Link>
          </div>
        </SectionCard>

        <SectionCard
          title={t('serverSettings.dataExport')}
          icon={<Icon name="download" size={20} />}
          description={t('backups.exportDesc')}
        >
          <div className="settings-test-row">
            <SettingToggle
              title={t('serverSettings.exportIncludeMedia')}
              hint={t('serverSettings.exportIncludeMediaHint')}
              checked={exportIncludeMedia}
              onCheckedChange={setExportIncludeMedia}
            />
            <Button variant="secondary" type="button" className="secondary" onClick={downloadExport}>
              {t('serverSettings.dataExportDownload')}
            </Button>
          </div>
          {exportStarted && <p className="hint">{t('serverSettings.dataExportStarted')}</p>}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('backups.deleteTitle')}
        description={t('backups.deleteBody', { name: toDelete?.name ?? '' })}
        confirmLabel={t('backups.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmDelete}
        busy={deleting}
      />

      {toRestore && (
        <AdminModal title={t('backups.restoreTitle')} onClose={() => setToRestore(null)} descriptionId="restore-desc">
          <form onSubmit={startRestore} className="backups-restore-form">
            <p id="restore-desc">
              {t('backups.restoreIntro', { date: new Date(toRestore.createdAt).toLocaleString() })}
            </p>
            <ul className="backups-restore-list">
              <li>{t('backups.restorePointSafety')}</li>
              <li>{t('backups.restorePointReplace')}</li>
              <li>{t('backups.restorePointSignOut')}</li>
              <li>{t('backups.restorePointSecrets')}</li>
            </ul>
            <label>
              {t('backups.restoreConfirmLabel', { name: overview.confirmName })}
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                placeholder={overview.confirmName}
              />
            </label>
            {restoreError && <p className="test-err">{restoreError}</p>}
            <div className="backups-restore-actions">
              <a href={BACKUP_DOCS_URL} target="_blank" rel="noreferrer" className="hint">
                {t('setup.restoreDocsLink')}
              </a>
              <Button type="button" variant="ghost" onClick={() => setToRestore(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirmText.trim().toLowerCase() !== overview.confirmName.toLowerCase()}
              >
                {t('backups.restoreButton')}
              </Button>
            </div>
          </form>
        </AdminModal>
      )}
    </>
  )
}
