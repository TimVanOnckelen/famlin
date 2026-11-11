import crypto from 'crypto'
import fsp from 'fs/promises'
import path from 'path'
import { prisma } from '../../db.js'
import { uploadsDir } from '../../config.js'
import { clearSessionCache } from '../../plugins/auth.js'
import { invalidateSettingsCache } from '../settings.js'
import { restoreArchive, RestoreError, RESTORE_WORKDIR_PREFIX } from '../import.js'
import { parseBackupArchiveFileName } from './archive.js'
import { parseDumpFileName } from './dbDump.js'
import { restoreDump, RestoreDumpError } from './restoreDump.js'
import { restoreAllMediaFromMirror } from './mediaRestore.js'
import { BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR } from './paths.js'
import { SETUP_ADVISORY_LOCK_KEY } from '../setupLock.js'
import { beginRestore, endRestore, runBackup } from './index.js'

// Restoring a backup onto a RUNNING server, from the admin Backups page
// (issue #461). Replaces everything: the database rows (in one transaction
// for a zip; pg_restore for a legacy dump) and any media the backup needs
// that storage lacks. In order:
//  1. claim the restore slot (no backup may start; the API answers 503 —
//     see app.ts — so nobody writes into a database about to be replaced);
//  2. take a SAFETY BACKUP of the current state, without rotating older
//     backups away — if that fails, nothing is restored;
//  3. restore, lifting every tokenVersion above any in use, so every session
//     (the restoring admin's included) ends;
//  4. clear the session and settings caches.
// It runs in the background (the route answers 202); GET
// /api/auth/restore-status reports the outcome, since the admin who started
// it is signed out by it.

export type RunningRestoreErrorCode =
  | 'unknownBackup'
  | 'busy'
  | 'safetyBackupFailed'
  | 'archiveTooNew'
  | 'invalidArchive'
  | 'missingMedia'
  | 'adminRequired'
  | 'restoreFailed'

export class RunningRestoreError extends Error {
  constructor(readonly code: RunningRestoreErrorCode) {
    super(code)
    this.name = 'RunningRestoreError'
  }
}

export interface RestoreStatus {
  running: boolean
  file: string | null
  startedAt: string | null
  finishedAt: string | null
  ok: boolean | null
  // A code only, never a message: this is served without authentication.
  error: RunningRestoreErrorCode | null
  safetyBackup: string | null
}

let status: RestoreStatus = {
  running: false,
  file: null,
  startedAt: null,
  finishedAt: null,
  ok: null,
  error: null,
  safetyBackup: null,
}

export function getRestoreStatus(): RestoreStatus {
  return { ...status }
}

export function backupFileKind(file: string): 'archive' | 'dump' | null {
  if (parseBackupArchiveFileName(file)) return 'archive'
  if (parseDumpFileName(file)) return 'dump'
  return null
}

export function backupFilePath(file: string): string | null {
  const kind = backupFileKind(file)
  if (kind === 'archive') return path.join(BACKUP_ARCHIVE_DIR, file)
  if (kind === 'dump') return path.join(BACKUP_DB_DIR, file)
  return null
}

function mapError(err: unknown): RunningRestoreErrorCode {
  if (err instanceof RunningRestoreError) return err.code
  if (err instanceof RestoreError) {
    if (err.code === 'archiveTooNew' || err.code === 'missingMedia' || err.code === 'adminRequired') return err.code
    if (err.code === 'busy') return 'busy'
    return 'invalidArchive'
  }
  if (err instanceof RestoreDumpError) {
    if (err.code === 'dumpTooNew') return 'archiveTooNew'
    if (err.code === 'invalidDump') return 'invalidArchive'
    if (err.code === 'busy') return 'busy'
    if (err.code === 'unknownDump') return 'unknownBackup'
    return 'restoreFailed'
  }
  return 'restoreFailed'
}

// Indirection so tests can stub the safety backup's pg_dump through backupDeps
// and still see the call order.
export const restoreRunningDeps = { runBackup }

/**
 * Validates `file` and claims the restore slot synchronously, then runs the
 * restore in the background. Throws RunningRestoreError('unknownBackup' |
 * 'busy') before anything starts; the returned promise settles when it ends.
 */
export async function startRunningRestore(
  file: string,
  log: { error: (obj: unknown, msg: string) => void }
): Promise<{ done: Promise<void> }> {
  const filePath = backupFilePath(file)
  const stat = filePath ? await fsp.lstat(filePath).catch(() => null) : null
  if (!filePath || !stat?.isFile()) throw new RunningRestoreError('unknownBackup')
  if (!beginRestore()) throw new RunningRestoreError('busy')

  status = {
    running: true,
    file,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    error: null,
    safetyBackup: null,
  }

  const done = (async () => {
    try {
      let safety
      try {
        safety = await restoreRunningDeps.runBackup('safety', new Date(), { prune: false })
      } catch (err) {
        log.error(err, 'safety backup before restore failed; nothing was restored')
        throw new RunningRestoreError('safetyBackupFailed')
      }
      status.safetyBackup = safety.archiveFile

      const { _max } = await prisma.user.aggregate({ _max: { tokenVersion: true } })
      const minTokenVersion = (_max.tokenVersion ?? 0) + 1

      if (backupFileKind(file) === 'archive') {
        const workDir = path.join(uploadsDir, `${RESTORE_WORKDIR_PREFIX}${crypto.randomUUID()}`)
        await fsp.mkdir(workDir, { recursive: true })
        try {
          await restoreArchive({
            zipPath: filePath,
            workDir,
            lockKey: SETUP_ADVISORY_LOCK_KEY,
            replaceExisting: true,
            minTokenVersion,
          })
        } finally {
          await fsp.rm(workDir, { recursive: true, force: true })
        }
      } else {
        await restoreDump(BACKUP_DB_DIR, file, SETUP_ADVISORY_LOCK_KEY, { replaceExisting: true, minTokenVersion })
        try {
          await restoreAllMediaFromMirror()
        } catch (err) {
          log.error(err, 'dump restored, but copying media from the backups mirror failed')
        }
      }
      status.ok = true
    } catch (err) {
      if (!(err instanceof RunningRestoreError)) log.error(err, 'restore failed')
      status.ok = false
      status.error = mapError(err)
    } finally {
      clearSessionCache()
      invalidateSettingsCache()
      status.running = false
      status.finishedAt = new Date().toISOString()
      endRestore()
    }
  })()
  return { done }
}
