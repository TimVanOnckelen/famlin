import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  assertValidStorageKey,
  assertValidStoragePrefix,
  resolveByteRange,
  type ByteRange,
  type StorageBackend,
  type StorageBody,
  type StoredObject,
  type StoredObjectInfo,
} from './types.js'

// Prefix of in-flight write files. Dot-prefixed so list() never reports
// them (nor any other dotfile, e.g. import.ts's `.restore-*` work dirs).
const TEMP_PREFIX = '.tmp-'

// The default driver: objects are plain files under `rootDir` (the uploads
// volume), at exactly the path their key names — so switching an existing
// deployment to this driver is a no-op, and its files stay usable by
// @fastify/static and the archiver until every caller goes through the
// StorageBackend interface.
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
      } else if (body instanceof Readable) {
        await pipeline(body, fs.createWriteStream(temp))
      } else {
        await fsp.copyFile(body.filePath, temp)
      }
      await fsp.rename(temp, target)
    } catch (err) {
      await fsp.rm(temp, { force: true })
      throw err
    }
  }

  async get(key: string, options?: { range?: ByteRange }): Promise<StoredObject | null> {
    const info = await this.stat(key)
    if (!info) return null
    const filePath = this.resolve(key)

    if (options?.range) {
      const range = resolveByteRange(options.range, info.size)
      return { ...info, range, stream: fs.createReadStream(filePath, range) }
    }
    return { ...info, range: null, stream: fs.createReadStream(filePath) }
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const st = await fsp.stat(this.resolve(key))
      if (!st.isFile()) return null
      return { key, size: st.size, lastModified: st.mtime }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true })
  }

  async *list(prefix = ''): AsyncIterable<StoredObjectInfo> {
    assertValidStoragePrefix(prefix)
    // Walk only the deepest directory the prefix fully names, then filter on
    // the rest — `originals/` walks originals/, `abc` walks the root.
    const slash = prefix.lastIndexOf('/')
    const baseKey = slash === -1 ? '' : prefix.slice(0, slash)
    for await (const info of this.walk(baseKey)) {
      if (info.key.startsWith(prefix)) yield info
    }
  }

  private async *walk(dirKey: string): AsyncIterable<StoredObjectInfo> {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dirKey ? this.resolve(dirKey) : this.rootDir, { withFileTypes: true })
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const key = dirKey ? `${dirKey}/${entry.name}` : entry.name
      // Skip anything a key couldn't name (stray files with spaces etc.) —
      // they were never written through Famlin, and list() promises only
      // keys the other methods accept.
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

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
