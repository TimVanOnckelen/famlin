import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import type { StorageBackend } from '../storage/types.js'
import fsp from 'fs/promises'
import path from 'path'

// Inside the mirror: `.deleted/<YYYY-MM-DD>/<original relative path>` holds
// files that disappeared from uploads/ (a hard-deleted post, an expired
// story), kept DELETED_RETENTION_DAYS before being pruned for good — so an
// accidental delete is recoverable without the mirror growing forever.
export const DELETED_DIR = '.deleted'
export const DELETED_RETENTION_DAYS = 30

// uploads/derived/ is a regenerable cache (HEIC renditions, see
// uploadVariants.ts) — not worth mirroring.
const SKIPPED_TOP_LEVEL = new Set(['derived', DELETED_DIR])
const TMP_SUFFIX = '.famlin-tmp'
const DAY_MS = 24 * 60 * 60 * 1000

export interface MirrorResult {
  fileCount: number
  totalBytes: number
  copied: number
  copiedBytes: number
  movedToDeleted: number
  prunedDeletedDays: number
}

// Relative path → size of every regular file under `root` (symlinks are
// skipped, so a link can't make the mirror read outside uploads/).
async function listFiles(root: string): Promise<Map<string, number>> {
  const files = new Map<string, number>()
  async function walk(rel: string) {
    let entries
    try {
      entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name
      if (!rel && SKIPPED_TOP_LEVEL.has(entry.name)) continue
      if (entry.isDirectory()) {
        await walk(childRel)
      } else if (entry.isFile()) {
        const { size } = await fsp.stat(path.join(root, childRel))
        files.set(childRel, size)
      }
    }
  }
  await walk('')
  return files
}

export function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// One incremental pass: copy every file in `src` the mirror doesn't have yet
// (uploads are immutable and UUID-named, so presence + size is enough — no
// hashing), move mirror files whose source is gone into today's `.deleted/`
// folder, and prune `.deleted/` folders older than the retention window.
export async function mirrorUploads(
  src: string | StorageBackend,
  dest: string,
  now: Date,
  deletedRetentionDays = DELETED_RETENTION_DAYS,
  preserveMedia = false
): Promise<MirrorResult> {
  await fsp.mkdir(dest, { recursive: true })
  const result: MirrorResult = {
    fileCount: 0,
    totalBytes: 0,
    copied: 0,
    copiedBytes: 0,
    movedToDeleted: 0,
    prunedDeletedDays: 0,
  }

  const srcFiles = new Map<string, number>()
  if (typeof src === 'string') {
    for (const [key, size] of await listFiles(src)) srcFiles.set(key, size)
  } else {
    // Complete enumeration before modifying the mirror: a failed fallback
    // must never make its library look deleted.
    for await (const object of src.list()) {
      if (!SKIPPED_TOP_LEVEL.has(object.key.split('/')[0])) srcFiles.set(object.key, object.size)
    }
  }
  const destFiles = await listFiles(dest)

  for (const [rel, size] of srcFiles) {
    result.fileCount += 1
    result.totalBytes += size
    if (destFiles.get(rel) === size) continue

    const target = path.join(dest, rel)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    // Copy-then-rename, so an interrupted copy never leaves a partial file
    // under the real name (a leftover temp file is cleaned up below).
    if (typeof src === 'string') await fsp.copyFile(path.join(src, rel), target + TMP_SUFFIX)
    else {
      const object = await src.get(rel)
      if (!object) throw new Error('Backup media disappeared')
      try {
        await pipeline(object.stream, createWriteStream(target + TMP_SUFFIX))
      } finally {
        object.stream.destroy()
      }
    }
    await fsp.rename(target + TMP_SUFFIX, target)
    result.copied += 1
    result.copiedBytes += size
  }

  const deletedToday = path.join(dest, DELETED_DIR, dayStamp(now))
  for (const rel of destFiles.keys()) {
    if (srcFiles.has(rel) || (preserveMedia && !rel.startsWith('branding/'))) continue
    const from = path.join(dest, rel)
    if (rel.endsWith(TMP_SUFFIX)) {
      await fsp.rm(from, { force: true })
      continue
    }
    const to = path.join(deletedToday, rel)
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.rename(from, to)
    result.movedToDeleted += 1
  }

  // Disabling media backups preserves the entire existing media mirror,
  // including its retained deletion history.
  result.prunedDeletedDays = preserveMedia
    ? 0
    : await pruneDeleted(path.join(dest, DELETED_DIR), now, deletedRetentionDays)
  return result
}

// Removes `.deleted/<YYYY-MM-DD>` folders older than `retentionDays`. Anything not named like a date is left alone.
export async function pruneDeleted(deletedRoot: string, now: Date, retentionDays: number): Promise<number> {
  let names: string[]
  try {
    names = await fsp.readdir(deletedRoot)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }

  const cutoff = now.getTime() - retentionDays * DAY_MS
  let pruned = 0
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue
    // Measured from the end of that day, so every file gets at least the
    // full retention window, whatever time of day it was parked.
    const dayEnd = Date.parse(`${name}T00:00:00Z`) + DAY_MS
    if (Number.isNaN(dayEnd) || dayEnd > cutoff) continue
    await fsp.rm(path.join(deletedRoot, name), { recursive: true, force: true })
    pruned += 1
  }
  return pruned
}
