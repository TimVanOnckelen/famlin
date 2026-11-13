import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { finished } from 'stream/promises'
import { buildExportArchive, type MediaLocation } from '../export.js'
import { readArchiveManifest } from '../import.js'
import { listDumps } from './restoreDump.js'

// Famlin backups (issue #461) in the backups volume: the same zip the admin
// export produces (services/export.ts), written by the scheduled job without
// media — those live in the incremental mirror next to it (mirror.ts), so N
// backups don't cost N× the media library.

const ARCHIVE_PREFIX = 'famlin-backup-'
const ARCHIVE_SUFFIX = '.zip'
const PARTIAL_SUFFIX = '.partial'

// `famlin-backup-2026-10-20T03-00-00-000Z.zip`, like dumpFileName(): lexical
// order is chronological order.
export function backupArchiveFileName(now: Date): string {
  return `${ARCHIVE_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}${ARCHIVE_SUFFIX}`
}

// Exactly what backupArchiveFileName() produces: a matching name can only
// ever resolve inside the backups directory.
const ARCHIVE_NAME_PATTERN = /^famlin-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/

/** When the backup was taken, from its file name, or `null` if `name` isn't a backup archive name. */
export function parseBackupArchiveFileName(name: string): Date | null {
  const m = ARCHIVE_NAME_PATTERN.exec(name)
  if (!m) return null
  const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// Writes a data-only backup zip into `dir`. `.partial` first, renamed on
// success, so retention and restore never see a truncated archive.
export async function writeBackupArchive(
  dir: string,
  now: Date,
  mediaLocation: Exclude<MediaLocation, 'archive'>,
  trigger?: string
): Promise<{ file: string; bytes: number }> {
  await fsp.mkdir(dir, { recursive: true })
  const finalPath = path.join(dir, backupArchiveFileName(now))
  const partialPath = finalPath + PARTIAL_SUFFIX
  let failure: Error | null = null
  try {
    const archive = await buildExportArchive(
      false,
      (err) => {
        failure = err
      },
      { mediaLocation, trigger }
    )
    const out = fs.createWriteStream(partialPath)
    archive.pipe(out)
    await archive.finalize()
    await finished(out)
    if (failure) throw failure
    await fsp.rename(partialPath, finalPath)
  } catch (err) {
    await fsp.rm(partialPath, { force: true })
    throw err
  }
  const { size } = await fsp.stat(finalPath)
  return { file: path.basename(finalPath), bytes: size }
}

// Keeps the `keep` newest backup archives in `dir` and deletes the rest, plus
// any leftover `.partial` file. Returns the deleted names. Only ever touches
// names backupArchiveFileName() produces.
export async function pruneBackupArchives(dir: string, keep: number): Promise<string[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const archives = names
    .filter((n) => parseBackupArchiveFileName(n))
    .sort()
    .reverse()
  const partials = names.filter(
    (n) => n.endsWith(ARCHIVE_SUFFIX + PARTIAL_SUFFIX) && parseBackupArchiveFileName(n.slice(0, -PARTIAL_SUFFIX.length))
  )
  const toDelete = [...archives.slice(Math.max(keep, 1)), ...partials]
  for (const name of toDelete) await fsp.rm(path.join(dir, name), { force: true })
  return toDelete
}

export interface BackupListing {
  name: string
  // 'archive' = a Famlin backup zip; 'dump' = a legacy pg_dump (until v1.0.0).
  type: 'archive' | 'dump'
  size: number
  createdAt: string
  // Archives only; null when the manifest can't be read (the file is listed
  // anyway, flagged, so an admin sees it rather than wondering where it went).
  serverVersion: string | null
  mediaLocation: MediaLocation | null
  // Format 2+: accounts come back with their passwords.
  credentials: boolean
  // Taken automatically right before a restore on a running server.
  safety: boolean
  valid: boolean
}

/** Every backup in the volume — zips in `archiveDir`, dumps in `dumpDir` — newest first. */
export async function listBackups(archiveDir: string, dumpDir: string): Promise<BackupListing[]> {
  const out: BackupListing[] = []
  const names = await fsp.readdir(archiveDir).catch(() => [] as string[])
  for (const name of names) {
    const createdAt = parseBackupArchiveFileName(name)
    if (!createdAt) continue
    const file = path.join(archiveDir, name)
    const stat = await fsp.lstat(file).catch(() => null)
    if (!stat?.isFile()) continue
    const manifest = await readArchiveManifest(file).catch(() => null)
    out.push({
      name,
      type: 'archive',
      size: stat.size,
      createdAt: createdAt.toISOString(),
      serverVersion: manifest?.serverVersion ?? null,
      mediaLocation: manifest ? (manifest.mediaLocation ?? (manifest.includeMedia ? 'archive' : 'storage')) : null,
      credentials: !!manifest && manifest.format >= 2 && manifest.credentials,
      safety: manifest?.trigger === 'safety',
      valid: !!manifest,
    })
  }
  for (const dump of await listDumps(dumpDir)) {
    out.push({
      ...dump,
      type: 'dump',
      serverVersion: null,
      mediaLocation: 'mirror',
      credentials: true,
      safety: false,
      valid: true,
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
