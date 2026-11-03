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

// Failover is fixed for this process: switching back automatically could hide
// objects written to fallback or expose stale versions from primary.
export class ApplicationStorage implements StorageBackend {
  private usingFallback = false
  constructor(
    private readonly primary: StorageConfiguration,
    private readonly fallback: StorageConfiguration | null
  ) {}
  get id() {
    return this.writer.id
  }
  private get writer() {
    return this.usingFallback ? this.fallback!.backend : this.primary.backend
  }
  getRuntimeStatus() {
    return { usingFallback: this.usingFallback }
  }
  async init() {
    // Repeated app construction must not switch a running instance back.
    if (this.usingFallback) return this.fallback!.backend.init()
    try {
      await this.primary.backend.init()
    } catch {
      if (!this.fallback) throw new Error('Primary storage unavailable and no fallback configured')
      await this.fallback.backend.init()
      this.usingFallback = true
    }
  }
  isWritable() {
    return this.writer.isWritable()
  }
  put(key: string, body: StorageBody) {
    return withStorageKey(key, () => this.writer.put(key, body))
  }
  async get(key: string, options?: { range?: ByteRange }) {
    if (this.usingFallback) return this.writer.get(key, options)
    return (await this.primary.backend.get(key, options)) ?? (await this.fallback?.backend.get(key, options)) ?? null
  }
  async stat(key: string) {
    if (this.usingFallback) return this.writer.stat(key)
    return (await this.primary.backend.stat(key)) ?? (await this.fallback?.backend.stat(key)) ?? null
  }
  delete(key: string) {
    // We cannot delete an unreachable primary copy. Reporting success would
    // resurrect it after restart/migration, so retain both copies until recovery.
    if (this.usingFallback) return Promise.reject(new Error('Cannot delete media while primary storage is unavailable'))
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
    for (const backend of this.usingFallback ? [this.writer] : [this.primary.backend, this.fallback?.backend]) {
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
export function getStorageRuntimeStatus() {
  return active.getRuntimeStatus()
}
