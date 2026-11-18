import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { finished, pipeline } from 'stream/promises'
import { buildExportArchive, type MediaLocation } from '../export.js'
import { readArchiveManifest } from '../import.js'
import { listDumps } from './restoreDump.js'
import { encryptStream } from './encryption.js'
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

export function isEncryptedBackupFileName(name: string): boolean {
  return !!parseBackupArchiveFileName(name) && name.endsWith(ENCRYPTED_SUFFIX)
}

// `famlin-backup-<ts>.meta.json` next to each backup: what the Backups page
// lists, readable without decrypting. Holds no family data — only what the
// file name and the manifest's header already say, plus the key it needs.
export function backupSidecarFileName(archiveName: string): string {
  return archiveName.replace(/\.zip(\.age)?$/, SIDECAR_SUFFIX)
}

export interface BackupSidecar {
  format: 1
  encrypted: boolean
  // The age1… public key an encrypted backup was encrypted to.
  keyId: string | null
  serverVersion: string
  mediaLocation: MediaLocation
  credentials: boolean
  trigger: string | null
}

async function readSidecar(dir: string, archiveName: string): Promise<BackupSidecar | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(dir, backupSidecarFileName(archiveName)), 'utf8'))
    return parsed && parsed.format === 1 ? (parsed as BackupSidecar) : null
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
): Promise<{ file: string; bytes: number; encrypted: boolean }> {
  await fsp.mkdir(dir, { recursive: true })
  const encrypted = !!recipient
  const finalPath = path.join(dir, backupArchiveFileName(now, encrypted))
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
    const sidecar: BackupSidecar = {
      format: 1,
      encrypted,
      keyId: recipient ?? null,
      serverVersion: pkg.version,
      mediaLocation,
      credentials: true,
      trigger: trigger ?? null,
    }
    await fsp.writeFile(
      path.join(dir, backupSidecarFileName(path.basename(finalPath))),
      JSON.stringify(sidecar, null, 2)
    )
    await fsp.rename(partialPath, finalPath)
  } catch (err) {
    // Stop a half-built archive (e.g. encryption failed before reading it).
    archive?.abort()
    await fsp.rm(partialPath, { force: true })
    await fsp.rm(path.join(dir, backupSidecarFileName(path.basename(finalPath))), { force: true })
    throw err
  }
  const { size } = await fsp.stat(finalPath)
  return { file: path.basename(finalPath), bytes: size, encrypted }
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
  // Age-encrypted (issue #495): `keyId` is the age1… public key it needs,
  // `keyAvailable` whether this server still holds that key (otherwise the
  // restore needs the admin's emergency kit). Null when unknown.
  encrypted: boolean
  keyId: string | null
  keyAvailable: boolean
}

/**
 * Every backup in the volume — zips in `archiveDir`, dumps in `dumpDir` —
 * newest first. `heldKeyIds`: the public keys this server can decrypt with.
 */
export async function listBackups(
  archiveDir: string,
  dumpDir: string,
  heldKeyIds: readonly string[] = []
): Promise<BackupListing[]> {
  const out: BackupListing[] = []
  const names = await fsp.readdir(archiveDir).catch(() => [] as string[])
  for (const name of names) {
    const createdAt = parseBackupArchiveFileName(name)
    if (!createdAt) continue
    const file = path.join(archiveDir, name)
    const stat = await fsp.lstat(file).catch(() => null)
    if (!stat?.isFile()) continue
    const encrypted = name.endsWith(ENCRYPTED_SUFFIX)
    // A plaintext zip's own manifest is authoritative (reading it also
    // tells a truncated file apart); the sidecar is for encrypted ones.
    const sidecar = encrypted ? await readSidecar(archiveDir, name) : null
    if (sidecar) {
      const keyId = encrypted ? sidecar.keyId : null
      out.push({
        name,
        type: 'archive',
        size: stat.size,
        createdAt: createdAt.toISOString(),
        serverVersion: sidecar.serverVersion,
        mediaLocation: sidecar.mediaLocation,
        credentials: sidecar.credentials,
        safety: sidecar.trigger === 'safety',
        valid: true,
        encrypted,
        keyId,
        keyAvailable: !encrypted || (!!keyId && heldKeyIds.includes(keyId)),
      })
      continue
    }
    // A plaintext zip, or an encrypted one without a sidecar (copied in by
    // hand): listed with what its name tells.
    const manifest = encrypted ? null : await readArchiveManifest(file).catch(() => null)
    out.push({
      name,
      type: 'archive',
      size: stat.size,
      createdAt: createdAt.toISOString(),
      serverVersion: manifest?.serverVersion ?? null,
      mediaLocation: manifest ? (manifest.mediaLocation ?? (manifest.includeMedia ? 'archive' : 'storage')) : null,
      credentials: !!manifest && manifest.format >= 2 && manifest.credentials,
      safety: manifest?.trigger === 'safety',
      valid: encrypted || !!manifest,
      encrypted,
      keyId: null,
      keyAvailable: !encrypted,
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
      encrypted: false,
      keyId: null,
      keyAvailable: true,
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
