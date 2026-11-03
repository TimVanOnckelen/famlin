import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import {
  assertValidStorageKey,
  resolveByteRange,
  type ByteRange,
  type StorageBackend,
  type StorageBody,
  type StoredObject,
  type StoredObjectInfo,
} from './types.js'

// Prefix of in-flight write files. Dot-prefixed, so no valid key can name
// one and list() never reports it.
const TEMP_PREFIX = '.tmp-'

// Opening with O_NOFOLLOW makes a symlink at the final path component fail
// (ELOOP) instead of serving whatever it points at — list() never reports
// symlinks, so get() mustn't serve them either. 0 where unsupported.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0

// The default driver: objects are plain files under `rootDir` (the uploads
// volume), at exactly the path their key names — so switching an existing
// deployment to this driver is a no-op.
export class LocalStorageBackend implements StorageBackend {
  readonly id = 'local'

  constructor(readonly rootDir: string) {}

  async init(): Promise<void> {
    await fsp.mkdir(this.rootDir, { recursive: true })
  }

  async isWritable(): Promise<boolean> {
    try {
      await fsp.access(this.rootDir, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  async put(key: string, body: StorageBody): Promise<void> {
    const target = this.resolve(key)
    const dir = path.dirname(target)
    await fsp.mkdir(dir, { recursive: true })

    // Write beside the target and rename into place: rename is atomic on the
    // same filesystem, so a reader never sees a half-written file.
    const temp = path.join(dir, `${TEMP_PREFIX}${crypto.randomUUID()}`)
    try {
      if (Buffer.isBuffer(body)) {
        await fsp.writeFile(temp, body)
      } else if ('filePath' in body) {
        await fsp.copyFile(body.filePath, temp)
      } else {
        await pipeline(body, fs.createWriteStream(temp))
      }
      await fsp.rename(temp, target)
    } catch (err) {
      await fsp.rm(temp, { force: true })
      throw err
    }
  }

  async get(key: string, options?: { range?: ByteRange }): Promise<StoredObject | null> {
    const file = await openLocalFile(this.resolve(key), options?.range)
    return file && { key, ...file }
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    const info = await statLocalFile(this.resolve(key))
    return info && { key, ...info }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true })
  }

  list(): AsyncIterable<StoredObjectInfo> {
    return this.walk('')
  }

  private async *walk(dirKey: string): AsyncIterable<StoredObjectInfo> {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dirKey ? this.resolve(dirKey) : this.rootDir, { withFileTypes: true })
    } catch (err) {
      // A missing nested directory can race with deletion; a missing root
      // means unavailable storage and must not masquerade as an empty library.
      if (dirKey && isNotFound(err)) return
      throw err
    }
    for (const entry of entries) {
      const key = dirKey ? `${dirKey}/${entry.name}` : entry.name
      // Skip anything a key couldn't name (temp files, dotfiles, stray files
      // with spaces etc.) — list() promises only keys the other methods
      // accept. Symlinks are neither isDirectory() nor isFile(), so skipped.
      try {
        assertValidStorageKey(key)
      } catch {
        continue
      }
      if (entry.isDirectory()) {
        yield* this.walk(key)
      } else if (entry.isFile()) {
        const info = await this.stat(key)
        if (info) yield info
      }
    }
  }

  private resolve(key: string): string {
    assertValidStorageKey(key)
    return path.join(this.rootDir, ...key.split('/'))
  }
}

// One regular file's size and mtime, or null when it's missing, a directory
// or a symlink.
export async function statLocalFile(filePath: string): Promise<{ size: number; lastModified: Date } | null> {
  try {
    const st = await fsp.lstat(filePath)
    return st.isFile() ? { size: st.size, lastModified: st.mtime } : null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

// Opens one regular file for streaming, optionally a byte range. Sizing and
// reading go through the same open handle, so a file deleted or replaced
// after this resolves can't turn into a stream error mid-response. Shared
// with the local media provider (services/media/local.ts), whose album files
// aren't storage keys.
export async function openLocalFile(filePath: string, range?: ByteRange): Promise<Omit<StoredObject, 'key'> | null> {
  let handle: fsp.FileHandle
  try {
    handle = await fsp.open(filePath, fs.constants.O_RDONLY | O_NOFOLLOW)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) {
      await handle.close()
      return null
    }
    const resolved = range ? resolveByteRange(range, st.size) : null
    // The stream owns the handle from here on and closes it when done.
    const stream = handle.createReadStream(resolved ?? {})
    return { size: st.size, lastModified: st.mtime, range: resolved, stream }
  } catch (err) {
    await handle.close()
    throw err
  }
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  // ELOOP: a symlink refused by O_NOFOLLOW — treated as not being there.
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}
