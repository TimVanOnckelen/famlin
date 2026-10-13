import { config, uploadsDir } from '../../config.js'
import { LocalStorageBackend } from './local.js'
import type { StorageBackend } from './types.js'

// The static driver registry — adding a storage service (S3-compatible,
// Azure Blob, ...) = implement StorageBackend in a new file in this
// directory and add a factory here, plus its id to STORAGE_DRIVER's enum in
// config.ts. Factories read their own driver-specific env vars, so an
// unconfigured driver costs nothing until it's selected. Unlike media
// provider ids, these aren't persisted anywhere — but STORAGE_DRIVER values
// in deployments' .env files are, so don't rename them either.
const drivers = new Map<string, () => StorageBackend>([['local', () => new LocalStorageBackend(uploadsDir)]])

export function createStorageBackend(driverId: string): StorageBackend {
  const factory = drivers.get(driverId)
  if (!factory) throw new Error(`Unknown storage driver: ${driverId}`)
  return factory()
}

export function listStorageDrivers(): string[] {
  return [...drivers.keys()]
}

let active: StorageBackend | null = null

// The backend selected by STORAGE_DRIVER, created on first use. Callers
// must go through this rather than holding on to a driver instance, so the
// test override below applies everywhere.
export function getStorage(): StorageBackend {
  active ??= createStorageBackend(config.STORAGE_DRIVER)
  return active
}

// Test-only escape hatch (mirrors __registerMediaProviderForTests): swap in
// another backend, then pass null to go back to the configured one.
export function __setStorageForTests(backend: StorageBackend | null): void {
  active = backend
}
