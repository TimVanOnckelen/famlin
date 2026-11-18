import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { finished, pipeline } from 'stream/promises'
import { buildExportArchive, type MediaLocation } from '../export.js'
import { readArchiveManifest } from '../import.js'
import { listDumps } from './restoreDump.js'
import { encryptStream, heldKeyIds } from './encryption.js'
import pkg from '../../../package.json' with { type: 'json' }

// Famlin backups (issue #461) in the backups volume: the same zip the admin
// export produces (services/export.ts), written by the scheduled job without
// media — those live in the incremental mirror next to it (mirror.ts), so N
// backups don't cost N× the media library.

const ARCHIVE_PREFIX = 'famlin-backup-'
const ARCHIVE_SUFFIX = '.zip'
// An encrypted backup (issue #495) is the same zip, age-encrypted.
const ENCRYPTED_SUFFIX = '.age'
const PARTIAL_SUFFIX = '.partial'
const SIDECAR_SUFFIX = '.meta.json'

// `famlin-backup-2026-10-20T03-00-00-000Z.zip` (or `.zip.age`), like
// dumpFileName(): lexical order is chronological order.
export function backupArchiveFileName(now: Date, encrypted = false): string {
  const name = `${ARCHIVE_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}${ARCHIVE_SUFFIX}`
  return encrypted ? name + ENCRYPTED_SUFFIX : name
}

// Exactly what backupArchiveFileName() produces: a matching name can only
// ever resolve inside the backups directory.
const ARCHIVE_NAME_PATTERN = /^famlin-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip(\.age)?$/

// `famlin-backup-<ts>.meta.json` next to an ENCRYPTED backup: what the
// Backups page lists without decrypting it. No family data.
export function backupSidecarFileName(archiveName: string): string {
  return archiveName.replace(/\.zip(\.age)?$/, SIDECAR_SUFFIX)
}

interface BackupSidecar {
  keyId: string // the age1… public key it was encrypted to
  serverVersion: string
  mediaLocation: MediaLocation
  trigger: string | null
}

async function readSidecar(dir: string, archiveName: string): Promise<BackupSidecar | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, backupSidecarFileName(archiveName)), 'utf8'))
  } catch {
    return null
  }
}

/** Deletes a backup archive and its sidecar. */
export async function removeBackupArchive(dir: string, archiveName: string): Promise<void> {
  await fsp.rm(path.join(dir, archiveName), { force: true })
  await fsp.rm(path.join(dir, backupSidecarFileName(archiveName)), { force: true })
}

/** When the backup was taken, from its file name, or `null` if `name` isn't a backup archive name. */
export function parseBackupArchiveFileName(name: string): Date | null {
  const m = ARCHIVE_NAME_PATTERN.exec(name)
  if (!m) return null
  const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// Writes a data-only backup zip into `dir`, age-encrypted to `recipient`
// when given. `.partial` first, renamed on success, so retention and restore
// never see a truncated archive; an encryption failure fails the backup —
// there is no plaintext fallback.
export async function writeBackupArchive(
  dir: string,
  now: Date,
  mediaLocation: Exclude<MediaLocation, 'archive'>,
  trigger?: string,
  recipient?: string | null
): Promise<{ file: string; bytes: number }> {
  await fsp.mkdir(dir, { recursive: true })
  const finalPath = path.join(dir, backupArchiveFileName(now, !!recipient))
  const partialPath = finalPath + PARTIAL_SUFFIX
  let failure: Error | null = null
  let archive: Awaited<ReturnType<typeof buildExportArchive>> | null = null
  try {
    archive = await buildExportArchive(
      false,
      (err) => {
        failure = err
      },
      { mediaLocation, trigger }
    )
    const out = fs.createWriteStream(partialPath)
    if (recipient) {
      const ciphertext = await encryptStream(archive, { recipient })
      await Promise.all([pipeline(ciphertext, out), archive.finalize()])
    } else {
      archive.pipe(out)
      await archive.finalize()
      await finished(out)
    }
    if (failure) throw failure
    if (recipient) {
      const sidecar: BackupSidecar = {
        keyId: recipient,
        serverVersion: pkg.version,
        mediaLocation,
        trigger: trigger ?? null,
      }
      await fsp.writeFile(path.join(dir, backupSidecarFileName(path.basename(finalPath))), JSON.stringify(sidecar))
    }
    await fsp.rename(partialPath, finalPath)
  } catch (err) {
    // Stop a half-built archive (e.g. encryption failed before reading it).
    archive?.abort()
    await fsp.rm(partialPath, { force: true })
    await fsp.rm(path.join(dir, backupSidecarFileName(path.basename(finalPath))), { force: true })
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
    (n) => n.endsWith(PARTIAL_SUFFIX) && parseBackupArchiveFileName(n.slice(0, -PARTIAL_SUFFIX.length))
  )
  const toDelete = [...archives.slice(Math.max(keep, 1)), ...partials]
  for (const name of toDelete) {
    if (name.endsWith(PARTIAL_SUFFIX)) await fsp.rm(path.join(dir, name), { force: true })
    else await removeBackupArchive(dir, name)
  }
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
  // Age-encrypted (issue #495): `keyId` is the age1… public key it needs (from
  // its sidecar), `keyAvailable` whether this server holds it — otherwise
  // the restore needs the emergency kit.
  encrypted: boolean
  keyId: string | null
  keyAvailable: boolean
}

// What the listing knows about one archive: an encrypted one from its
// sidecar, a plaintext one from its own manifest (which also tells a
// truncated file apart).
async function archiveInfo(dir: string, name: string) {
  if (name.endsWith(ENCRYPTED_SUFFIX)) {
    const sidecar = await readSidecar(dir, name)
    return {
      serverVersion: sidecar?.serverVersion ?? null,
      mediaLocation: sidecar?.mediaLocation ?? null,
      credentials: true,
      safety: sidecar?.trigger === 'safety',
      valid: true,
      encrypted: true,
      keyId: sidecar?.keyId ?? null,
    }
  }
  const manifest = await readArchiveManifest(path.join(dir, name)).catch(() => null)
  return {
    serverVersion: manifest?.serverVersion ?? null,
    mediaLocation: manifest ? (manifest.mediaLocation ?? (manifest.includeMedia ? 'archive' : 'storage')) : null,
    credentials: !!manifest && manifest.format >= 2 && manifest.credentials,
    safety: manifest?.trigger === 'safety',
    valid: !!manifest,
    encrypted: false,
    keyId: null,
  }
}

/** Every backup in the volume — zips in `archiveDir`, dumps in `dumpDir` — newest first. */
export async function listBackups(archiveDir: string, dumpDir: string): Promise<BackupListing[]> {
  const [names, heldKeys, dumps] = await Promise.all([
    fsp.readdir(archiveDir).catch(() => [] as string[]),
    heldKeyIds(),
    listDumps(dumpDir),
  ])
  const archives = await Promise.all(
    names.map(async (name): Promise<BackupListing | null> => {
      const createdAt = parseBackupArchiveFileName(name)
      const stat = createdAt ? await fsp.lstat(path.join(archiveDir, name)).catch(() => null) : null
      if (!createdAt || !stat?.isFile()) return null
      const info = await archiveInfo(archiveDir, name)
      return {
        name,
        type: 'archive',
        size: stat.size,
        createdAt: createdAt.toISOString(),
        ...info,
        keyAvailable: !info.encrypted || (!!info.keyId && heldKeys.includes(info.keyId)),
      }
    })
  )
  const out = archives.filter((b): b is BackupListing => b !== null)
  for (const dump of dumps) {
    out.push({
      ...dump,
      type: 'dump',
      serverVersion: null,
      mediaLocation: 'mirror',
      credentials: true,
      safety: false,
      valid: true,
      encrypted: false,
      keyId: null,
      keyAvailable: true,
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
