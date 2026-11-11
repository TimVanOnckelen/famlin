import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { uploadsDir } from '../../config.js'
import { getStorage } from '../storage/registry.js'
import { assertValidStorageKey } from '../storage/types.js'
import { BACKUP_UPLOADS_DIR } from './paths.js'
import { DELETED_DIR, MIRROR_TMP_SUFFIX } from './mirror.js'

// Restoring media from the backups volume's incremental mirror
// (<backupsDir>/uploads/, written by mirror.ts) back into the server's media
// storage — so a restore needs no `docker compose cp` and no multi-GB upload
// (issue #461). Mirror files are copied, never moved: the mirror stays a
// complete backup after the restore.
//
// Keys come from the mirror's own directory listing or an archive's
// manifest; every one goes through assertValidStorageKey(), and the resolved
// mirror path must stay inside the mirror, so neither can reach outside it.

export interface MediaRestoreResult {
  restored: number
  restoredBytes: number
  // Keys neither in storage nor (with the right size) in the mirror.
  missing: string[]
}

function mirrorPath(mirrorDir: string, key: string): string | null {
  try {
    assertValidStorageKey(key)
  } catch {
    return null
  }
  const file = path.resolve(mirrorDir, key)
  return file.startsWith(path.resolve(mirrorDir) + path.sep) ? file : null
}

async function fileSize(file: string): Promise<number | null> {
  const stat = await fsp.lstat(file).catch(() => null)
  return stat?.isFile() ? stat.size : null
}

// The mirror's copy of `key` with exactly `size` bytes: the live mirror first,
// then the `.deleted/<day>/` folders newest first — a file deleted from the
// server after the backup was taken has moved there.
async function findInMirror(mirrorDir: string, key: string, size: number): Promise<string | null> {
  const live = mirrorPath(mirrorDir, key)
  if (!live) return null
  if ((await fileSize(live)) === size) return live

  const deletedRoot = path.join(mirrorDir, DELETED_DIR)
  const days = await fsp.readdir(deletedRoot).catch(() => [] as string[])
  for (const day of days
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()) {
    const candidate = mirrorPath(path.join(deletedRoot, day), key)
    if (candidate && (await fileSize(candidate)) === size) return candidate
  }
  return null
}

async function install(key: string, file: string): Promise<void> {
  // Branding lives on the local uploads volume whatever the storage driver
  // (see services/branding/), like in installFiles() in import.ts.
  if (key.startsWith('branding/')) {
    const target = path.join(uploadsDir, key)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(file, target)
  } else {
    await getStorage().put(key, { filePath: file })
  }
}

async function isInStorage(key: string, size: number): Promise<boolean> {
  if (key.startsWith('branding/')) return (await fileSize(path.join(uploadsDir, key))) === size
  const info = await getStorage().stat(key)
  return !!info && info.size === size
}

/**
 * Makes sure every `required` object is in storage with its recorded size,
 * copying it from the mirror where it isn't. Used by an archive restore whose
 * media weren't in the zip (scheduled backups, "without media" downloads).
 */
export async function restoreRequiredMedia(
  required: { key: string; size: number }[],
  mirrorDir = BACKUP_UPLOADS_DIR
): Promise<MediaRestoreResult> {
  const result: MediaRestoreResult = { restored: 0, restoredBytes: 0, missing: [] }
  // Check everything first: a restore that is going to be refused for
  // missing media shouldn't have copied gigabytes into storage beforehand.
  const toCopy: { key: string; size: number; file: string }[] = []
  for (const { key, size } of required) {
    if (await isInStorage(key, size)) continue
    const file = await findInMirror(mirrorDir, key, size)
    if (file) toCopy.push({ key, size, file })
    else result.missing.push(key)
  }
  if (result.missing.length > 0) return result

  for (const { key, size, file } of toCopy) {
    await install(key, file)
    result.restored += 1
    result.restoredBytes += size
  }
  return result
}

/**
 * Copies every file in the mirror (minus `.deleted/`) that storage lacks or
 * holds with a different size. Used after a legacy `.dump` restore, which has
 * no manifest saying which files the database needs.
 */
export async function restoreAllMediaFromMirror(mirrorDir = BACKUP_UPLOADS_DIR): Promise<MediaRestoreResult> {
  const result: MediaRestoreResult = { restored: 0, restoredBytes: 0, missing: [] }
  if (!fs.existsSync(mirrorDir)) return result

  async function walk(rel: string): Promise<void> {
    const entries = await fsp.readdir(path.join(mirrorDir, rel), { withFileTypes: true })
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (!rel && entry.name === DELETED_DIR) continue
      if (entry.isDirectory()) {
        await walk(childRel)
        continue
      }
      // Symlinks never leave the mirror; an interrupted copy's temp file isn't media.
      if (!entry.isFile() || entry.name.endsWith(MIRROR_TMP_SUFFIX)) continue
      const file = mirrorPath(mirrorDir, childRel)
      if (!file) continue
      const size = (await fsp.stat(file)).size
      if (await isInStorage(childRel, size)) continue
      await install(childRel, file)
      result.restored += 1
      result.restoredBytes += size
    }
  }
  await walk('')
  return result
}
