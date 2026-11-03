import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Client } from '@aws-sdk/client-s3'
import { ApplicationStorage } from '../src/services/storage/registry.js'
import * as registry from '../src/services/storage/registry.js'
import { LocalStorageBackend } from '../src/services/storage/local.js'
import { S3StorageBackend } from '../src/services/storage/s3.js'
import type { StorageConfiguration } from '../src/services/storage/config.js'
import { storageStatus, startStorageMigration } from '../src/services/storage/migration.js'

let directory: string
let primary: StorageConfiguration
let fallback: StorageConfiguration
const configure = (directory: string): StorageConfiguration => ({
  backend: new LocalStorageBackend(directory),
  location: { driver: 'local', directory },
  fingerprint: directory,
})

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-failover-'))
  primary = configure(path.join(directory, 'primary'))
  fallback = configure(path.join(directory, 'fallback'))
  await primary.backend.init()
  await fallback.backend.init()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('storage startup failover', () => {
  it('keeps primary writes and missing-object fallback reads when primary is healthy', async () => {
    await fallback.backend.put('old.jpg', Buffer.from('old'))
    const storage = new ApplicationStorage(primary, fallback)
    await storage.init()
    await storage.put('new.jpg', Buffer.from('new'))
    expect(storage.getRuntimeStatus().usingFallback).toBe(false)
    expect(await primary.backend.stat('new.jpg')).not.toBeNull()
    expect(await fallback.backend.stat('new.jpg')).toBeNull()
    expect(await storage.stat('old.jpg')).not.toBeNull()
  })

  it('uses fallback for reads, writes, listing and health without contacting failed primary again', async () => {
    vi.spyOn(primary.backend, 'init').mockRejectedValue(new Error('unreachable'))
    const get = vi.spyOn(primary.backend, 'get')
    const stat = vi.spyOn(primary.backend, 'stat')
    const list = vi.spyOn(primary.backend, 'list')
    const storage = new ApplicationStorage(primary, fallback)
    await storage.init()
    expect(storage.getRuntimeStatus().usingFallback).toBe(true)
    await storage.put('photo.jpg', Buffer.from('photo'))
    expect(await fallback.backend.stat('photo.jpg')).not.toBeNull()
    expect(await storage.stat('photo.jpg')).not.toBeNull()
    const object = await storage.get('photo.jpg')
    expect(object).not.toBeNull()
    object!.stream.destroy()
    const keys = []
    for await (const object of storage.list()) keys.push(object.key)
    expect(keys).toEqual(['photo.jpg'])
    expect(await storage.isWritable()).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    // Do not delete only one copy and later resurrect an unreachable copy.
    await expect(storage.delete('photo.jpg')).rejects.toThrow('Cannot delete media')
    expect(await fallback.backend.stat('photo.jpg')).not.toBeNull()
    vi.mocked(primary.backend.init).mockResolvedValue()
    await storage.init()
    expect(storage.getRuntimeStatus().usingFallback).toBe(true)
    expect(primary.backend.init).toHaveBeenCalledTimes(1)
  })

  it('fails startup when no usable fallback exists', async () => {
    vi.spyOn(primary.backend, 'init').mockRejectedValue(new Error('unreachable'))
    await expect(new ApplicationStorage(primary, null).init()).rejects.toThrow('no fallback configured')
    vi.spyOn(fallback.backend, 'init').mockRejectedValue(new Error('fallback unavailable'))
    const storage = new ApplicationStorage(primary, fallback)
    await expect(storage.init()).rejects.toThrow('fallback unavailable')
    expect(storage.getRuntimeStatus().usingFallback).toBe(false)
  })

  it('reports unavailable primary and active fallback without waiting for a failed primary listing', async () => {
    vi.spyOn(registry, 'getStorageConfiguration').mockReturnValue({ primary, fallback })
    vi.spyOn(registry, 'getStorageRuntimeStatus').mockReturnValue({ usingFallback: true })
    const list = vi.spyOn(primary.backend, 'list')
    const status = await storageStatus()
    expect(status.usingFallback).toBe(true)
    expect(status.primary.available).toBe(false)
    expect(status.primary.files).toBeNull()
    expect(status.fallback?.available).toBe(true)
    expect(list).not.toHaveBeenCalled()
    await expect(startStorageMigration()).rejects.toThrow('Primary storage unavailable')
    await expect(startStorageMigration(fallback.fingerprint)).rejects.toThrow('Primary storage unavailable')
  })

  it('aborts the S3 startup probe after five seconds', async () => {
    vi.useFakeTimers()
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(
      (_command, options) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { abortSignal: AbortSignal }).abortSignal
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    // AbortSignal.timeout uses native timers, so substitute a timer controlled by Vitest.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), milliseconds)
      return controller.signal
    })
    const s3 = new S3StorageBackend({ bucket: 'test', prefix: '', region: 'us-east-1', forcePathStyle: true })
    const probe = expect(s3.init()).rejects.toThrow('S3 storage request failed')
    await vi.advanceTimersByTimeAsync(5000)
    await probe
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5000)
  })
})
