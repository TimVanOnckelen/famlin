import { readStorageConfig, assertDisjoint, type StorageConfiguration } from './config.js'
import { withStorageKey } from './locks.js'
import type { StorageBackend, StorageBody, ByteRange, StoredObjectInfo } from './types.js'

export function isMediaKey(key: string): boolean {
  return (
    !['branding', 'internal', 'tmp'].includes(key.split('/')[0]) &&
    !key.endsWith('.tmp') &&
    !key.endsWith('.famlin-tmp')
  )
}
const primary = readStorageConfig(process.env)!
const fallback = readStorageConfig(process.env, true)
if (fallback) assertDisjoint(primary.location, fallback.location)
export function getStorageConfiguration() {
  return { primary, fallback }
}

// Only genuine absence permits fallback. Permission/network errors propagate.
export class ApplicationStorage implements StorageBackend {
  constructor(
    private readonly primary: StorageConfiguration,
    private readonly fallback: StorageConfiguration | null
  ) {}
  get id() {
    return this.primary.backend.id
  }
  async init() {
    await this.primary.backend.init()
  }
  isWritable() {
    return this.primary.backend.isWritable()
  }
  put(key: string, body: StorageBody) {
    return withStorageKey(key, () => this.primary.backend.put(key, body))
  }
  async get(key: string, options?: { range?: ByteRange }) {
    return (await this.primary.backend.get(key, options)) ?? (await this.fallback?.backend.get(key, options)) ?? null
  }
  async stat(key: string) {
    return (await this.primary.backend.stat(key)) ?? (await this.fallback?.backend.stat(key)) ?? null
  }
  delete(key: string) {
    return withStorageKey(key, async (tx) => {
      // Remove source first: a partially failed deletion can never be copied
      // back by migration. Keep the Upload row until both deletions succeed.
      await this.fallback?.backend.delete(key)
      await this.primary.backend.delete(key)
      await tx.storageMigrationItem.updateMany({ where: { key }, data: { status: 'deleted', error: null } })
    })
  }
  async *list(): AsyncIterable<StoredObjectInfo> {
    const seen = new Set<string>()
    for (const backend of [this.primary.backend, this.fallback?.backend]) {
      if (!backend) continue
      for await (const object of backend.list()) {
        if (!isMediaKey(object.key) || seen.has(object.key)) continue
        seen.add(object.key)
        yield object
      }
    }
  }
}
const active = new ApplicationStorage(primary, fallback)
export function getStorage(): StorageBackend {
  return active
}
