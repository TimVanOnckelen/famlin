import path from 'path'
import { backupsDir, uploadsDir } from '../../config.js'
import { prisma } from '../../db.js'
import { getAllSettings, type ServerSettings } from '../settings.js'
import { recordJobRun } from '../jobRuns.js'
import { dumpDatabase, pruneDbDumps } from './dbDump.js'
import { mirrorUploads, type MirrorResult } from './mirror.js'

// Scheduled backups (issue #228): rotating `pg_dump -Fc` files in
// <backupsDir>/db/ plus one incremental mirror of uploads/ in
// <backupsDir>/uploads/. Deliberately not export zips — the export stores
// every photo again, so N copies would cost N× the media library.
export const BACKUP_DB_DIR = path.join(backupsDir, 'db')
export const BACKUP_UPLOADS_DIR = path.join(backupsDir, 'uploads')

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type BackupTrigger = 'scheduled' | 'manual'

export interface BackupResult {
  trigger: BackupTrigger
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
export const backupDeps = { dumpDatabase, mirrorUploads }

let running: Promise<BackupResult> | null = null

export function isBackupRunning(): boolean {
  return running !== null
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
export function runBackup(trigger: BackupTrigger, now = new Date()): Promise<BackupResult> {
  if (running) return Promise.reject(new BackupInProgressError())

  running = recordJobRun(
    'backup',
    async () => {
      const settings = await getAllSettings()
      const dump = await backupDeps.dumpDatabase(BACKUP_DB_DIR, now)
      const pruned = await pruneDbDumps(BACKUP_DB_DIR, settings.backupRetention)
      const mirror = await backupDeps.mirrorUploads(uploadsDir, BACKUP_UPLOADS_DIR, now)
      return { trigger, dumpFile: dump.file, dumpBytes: dump.bytes, prunedDumps: pruned.length, mirror }
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
