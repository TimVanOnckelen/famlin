import { getStorage } from '../storage/registry.js'
import { LocalStorageBackend } from '../storage/local.js'
import type { StorageBackend } from '../storage/types.js'
import { uploadsDir } from '../../config.js'
import { prisma } from '../../db.js'
import { getAllSettings, type ServerSettings } from '../settings.js'
import { recordJobRun } from '../jobRuns.js'
import { dumpDatabase, pruneDbDumps } from './dbDump.js'
import { mirrorUploads, type MirrorResult } from './mirror.js'
import { pruneBackupArchives, writeBackupArchive } from './archive.js'
import { BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR, BACKUP_UPLOADS_DIR } from './paths.js'

// Scheduled backups (issues #228, #461), each run writing:
//  1. a Famlin backup zip (the export.ts format, data only) into
//     <backupsDir>/, rotated to `backupRetention`;
//  2. one incremental mirror of uploads/ in <backupsDir>/uploads/ — the
//     zips' media, so N backups don't store every photo N times;
//  3. a `pg_dump -Fc` in <backupsDir>/db/, rotated to the same retention.
//
// TODO(v1.0.0): step 3 is a safety net for the switch to zips only. Remove
// pg_dump production (and dump restore, services/backup/restoreDump.ts) in
// v1.0.0 as a BREAKING CHANGE (`feat!:`), with an upgrade note telling admins
// to take one Famlin backup first. Tracked in issue #461.
export { BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR, BACKUP_UPLOADS_DIR }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// 'safety': taken automatically right before a restore on a running server.
export type BackupTrigger = 'scheduled' | 'manual' | 'safety'

export interface BackupResult {
  trigger: BackupTrigger
  archiveFile: string
  archiveBytes: number
  prunedArchives: number
  dumpFile: string
  dumpBytes: number
  prunedDumps: number
  mirror: MirrorResult
}

export class BackupInProgressError extends Error {
  constructor() {
    super('A backup is already running')
    this.name = 'BackupInProgressError'
  }
}

// Indirection so tests can stub the pg_dump call (CI's Postgres runs in a
// service container whose server version needn't match the runner's client).
export const backupDeps = { dumpDatabase, mirrorUploads, writeBackupArchive }

let running: Promise<BackupResult> | null = null
// Set for the whole of a restore on a running server (restoreRunning.ts): no
// scheduled or manual backup may start meanwhile — only the restore's own
// safety backup.
let restoreInProgress = false

export function isBackupRunning(): boolean {
  return running !== null
}

export function isRestoreRunning(): boolean {
  return restoreInProgress
}

/** Claims the restore slot; false when a backup or another restore is running. */
export function beginRestore(): boolean {
  if (restoreInProgress || running) return false
  restoreInProgress = true
  return true
}

export function endRestore(): void {
  restoreInProgress = false
}

export function backupIntervalMs(schedule: ServerSettings['backupSchedule']): number {
  return schedule === 'weekly' ? 7 * DAY_MS : DAY_MS
}

// Called by the hourly cron tick in server.ts (minute 0): due when backups are
// on, it's the configured hour (and a Sunday, for weekly), and no backup
// already started within the last hour — so a restart or a manual run during
// that hour doesn't produce a second one.
export function isBackupDue(
  now: Date,
  settings: Pick<ServerSettings, 'backupEnabled' | 'backupSchedule' | 'backupHour'>,
  lastStartedAt: Date | null
): boolean {
  if (!settings.backupEnabled) return false
  if (now.getHours() !== settings.backupHour) return false
  if (settings.backupSchedule === 'weekly' && now.getDay() !== 0) return false
  return !lastStartedAt || now.getTime() - lastStartedAt.getTime() >= HOUR_MS
}

// Runs one backup and records it as the `backup` job. Only one at a time:
// a second call while one is running throws BackupInProgressError.
// `prune: false` keeps every older backup — a safety backup must never rotate
// away the backup that is about to be restored.
export function runBackup(
  trigger: BackupTrigger,
  now = new Date(),
  options: { prune?: boolean } = {}
): Promise<BackupResult> {
  if (running || (restoreInProgress && trigger !== 'safety')) return Promise.reject(new BackupInProgressError())
  const prune = options.prune ?? true

  running = recordJobRun(
    'backup',
    async () => {
      const settings = await getAllSettings()
      // Without media mirroring (media on S3 with its own backups), the
      // restore expects them to still be in storage.
      const archive = await backupDeps.writeBackupArchive(
        BACKUP_ARCHIVE_DIR,
        now,
        settings.backupIncludeMedia ? 'mirror' : 'storage',
        trigger
      )
      const prunedArchives = prune ? await pruneBackupArchives(BACKUP_ARCHIVE_DIR, settings.backupRetention) : []
      const local = new LocalStorageBackend(uploadsDir)
      const media = getStorage()
      const source: StorageBackend = {
        id: media.id,
        init: () => media.init(),
        isWritable: () => media.isWritable(),
        put: (key, body) => media.put(key, body),
        delete: (key) => media.delete(key),
        get: (key, options) => (key.startsWith('branding/') ? local.get(key, options) : media.get(key, options)),
        stat: (key) => (key.startsWith('branding/') ? local.stat(key) : media.stat(key)),
        async *list() {
          if (settings.backupIncludeMedia) yield* media.list()
          for await (const object of local.list()) if (object.key.startsWith('branding/')) yield object
        },
      }
      const mirror = await backupDeps.mirrorUploads(
        source,
        BACKUP_UPLOADS_DIR,
        now,
        undefined,
        !settings.backupIncludeMedia
      )
      // Last, so a failing pg_dump (e.g. a client older than the server)
      // still leaves a complete zip + mirror — but fails the run, so the
      // admin is told.
      const dump = await backupDeps.dumpDatabase(BACKUP_DB_DIR, now)
      const pruned = prune ? await pruneDbDumps(BACKUP_DB_DIR, settings.backupRetention) : []
      return {
        trigger,
        archiveFile: archive.file,
        archiveBytes: archive.bytes,
        prunedArchives: prunedArchives.length,
        dumpFile: dump.file,
        dumpBytes: dump.bytes,
        prunedDumps: pruned.length,
        mirror,
      }
    },
    (result) => ({ ...result, mirror: { ...result.mirror } })
  ).finally(() => {
    running = null
  })
  return running
}

export async function runScheduledBackupIfDue(now = new Date()): Promise<BackupResult | null> {
  const settings = await getAllSettings()
  const status = await prisma.jobStatus.findUnique({ where: { job: 'backup' }, select: { lastStartedAt: true } })
  if (!isBackupDue(now, settings, status?.lastStartedAt ?? null)) return null
  if (isBackupRunning()) return null
  return runBackup('scheduled', now)
}
