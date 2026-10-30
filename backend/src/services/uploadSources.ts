import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { getStorage } from './storage/registry.js'
import { assertValidStorageKey } from './storage/types.js'
import path from 'path'
import { uploadsDir } from '../config.js'

// New originals retain their name under originals/<upload-id>/<name>.
// Existing originals/<upload-id>.<ext> remain readable through the same field.
export function uploadSourcePath(sourceFilename: string): string {
  const root = path.join(uploadsDir, 'originals')
  const resolved = path.resolve(root, sourceFilename)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid upload source path')
  }
  return resolved
}

// Metadata retains the exact original name for Live Photo pairing. Escape
// only names outside StorageBackend's URL-safe key alphabet, consistently
// across writes, reads, export/restore and deletion.
export function uploadSourceKey(sourceFilename: string): string {
  uploadSourcePath(sourceFilename) // reject traversal and absolute paths
  const segments = sourceFilename.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\')))
    throw new Error('Invalid upload source path')
  const key = `originals/${segments.map((segment) => (/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment) ? segment : `encoded-${createHash('sha256').update(segment).digest('hex')}${path.extname(segment).toLowerCase()}`)).join('/')}`
  assertValidStorageKey(key)
  return key
}

export function uploadLifecycleKey(assetKey: string): string {
  return `internal/upload-${assetKey}`
}

export async function withUploadSource<T>(
  sourceFilename: string,
  work: (source: string, directory: string) => Promise<T>
): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-process-'))
  try {
    const object = await getStorage().get(uploadSourceKey(sourceFilename))
    if (!object) throw new Error('Missing upload source')
    const source = path.join(directory, `source${path.extname(sourceFilename)}`)
    try {
      await pipeline(object.stream, createWriteStream(source))
    } finally {
      object.stream.destroy()
    }
    return await work(source, directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
