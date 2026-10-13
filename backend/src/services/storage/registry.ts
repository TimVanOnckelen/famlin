import { uploadsDir } from '../../config.js'
import { LocalStorageBackend } from './local.js'
import type { StorageBackend } from './types.js'

// The active storage backend. Only the `local` driver exists so far, so
// there's nothing to select yet — the S3-compatible and Azure drivers
// (issue #221) will add a STORAGE_DRIVER env var and a driver map here,
// mirroring services/media/registry.ts. Callers go through this rather than
// constructing a driver, so that switch touches only this file.
let active: StorageBackend | null = null

export function getStorage(): StorageBackend {
  active ??= new LocalStorageBackend(uploadsDir)
  return active
}
