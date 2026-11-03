import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { prisma } from '../src/db.js'
import { LocalStorageBackend } from '../src/services/storage/local.js'
import { S3StorageBackend } from '../src/services/storage/s3.js'
import { readStorageConfig, assertDisjoint, type StorageConfiguration } from '../src/services/storage/config.js'
import * as registry from '../src/services/storage/registry.js'
import { hashObject, startStorageMigration, resumeStorageMigration } from '../src/services/storage/migration.js'

let dir: string
let primary: StorageConfiguration
let fallback: StorageConfiguration
function location(backend: LocalStorageBackend): StorageConfiguration {
  return { backend, location: { driver: 'local', directory: backend.rootDir }, fingerprint: backend.rootDir }
}
async function waitForJob() {
  await vi.waitFor(
    async () => {
      const job = await prisma.storageMigration.findUnique({
        where: { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } },
      })
      expect(job).not.toBeNull()
      expect(['running', 'cleaning']).not.toContain(job!.status)
    },
    { timeout: 30_000, interval: 20 }
  )
  // Let the lock-holding transaction and in-process promise finish too.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(221028)`
  })
  return prisma.storageMigration.findUniqueOrThrow({
    where: { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } },
  })
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-migrate-test-'))
  primary = location(new LocalStorageBackend(path.join(dir, 'primary')))
  fallback = location(new LocalStorageBackend(path.join(dir, 'fallback')))
  await primary.backend.init()
  await fallback.backend.init()
  vi.spyOn(registry, 'getStorageConfiguration').mockImplementation(() => ({ primary, fallback }))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('storage configuration', () => {
  it('rejects overlapping sources, incomplete credentials and invalid drivers', () => {
    expect(() => assertDisjoint(primary.location, primary.location)).toThrow()
    const a = readStorageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'test', S3_PREFIX: 'a' })!
    const b = readStorageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'test', S3_PREFIX: 'a/b' })!
    expect(() => assertDisjoint(a.location, b.location)).toThrow()
    expect(() => readStorageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'x', S3_ACCESS_KEY_ID: 'secret' })).toThrow()
    expect(() => readStorageConfig({ STORAGE_DRIVER: 'azure' })).toThrow()
    expect(() =>
      readStorageConfig(
        { STORAGE_FALLBACK_DRIVER: 'local', STORAGE_FALLBACK_UPLOADS_DIR: path.join(dir, 'missing') },
        true
      )
    ).toThrow()
    const aws = readStorageConfig({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'test',
      S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
      S3_PREFIX: 'a/b',
    })!
    expect(() => assertDisjoint(a.location, aws.location)).toThrow()
    expect(JSON.stringify(a.location)).not.toContain('credentials')
  })
})
describe('online migration and cleanup', () => {
  it('copies legacy objects, excludes internal data, retries and cleans only after confirmation', async () => {
    await fallback.backend.put('legacy.jpg', Buffer.from('legacy'))
    await fallback.backend.put('originals/a.heic', Buffer.from('original'))
    await fallback.backend.put('derived/a.jpg', Buffer.from('derived'))
    await fallback.backend.put('branding/logo.png', Buffer.from('branding'))
    await startStorageMigration()
    expect((await waitForJob()).status).toBe('verified')
    expect(await hashObject(primary.backend, 'legacy.jpg')).toEqual(await hashObject(fallback.backend, 'legacy.jpg'))
    expect(await primary.backend.stat('branding/logo.png')).toBeNull()
    await startStorageMigration()
    await waitForJob()
    await expect(startStorageMigration('wrong')).rejects.toThrow()
    await startStorageMigration(fallback.fingerprint)
    expect((await waitForJob()).status).toBe('cleaned')
    expect(await fallback.backend.stat('legacy.jpg')).toBeNull()
    expect(await fallback.backend.stat('branding/logo.png')).not.toBeNull()
  })
  it('never overwrites conflicts and blocks cleanup', async () => {
    await fallback.backend.put('a.jpg', Buffer.from('source'))
    await fallback.backend.put('b.jpg', Buffer.from('uncontested'))
    await primary.backend.put('a.jpg', Buffer.from('different'))
    await startStorageMigration()
    expect((await waitForJob()).status).toBe('failed')
    expect(await primary.backend.stat('b.jpg')).not.toBeNull()
    await expect(startStorageMigration(fallback.fingerprint)).rejects.toThrow()
    expect(await hashObject(primary.backend, 'a.jpg')).not.toEqual(await hashObject(fallback.backend, 'a.jpg'))
    await primary.backend.delete('a.jpg')
    await startStorageMigration()
    expect((await waitForJob()).status).toBe('verified')
  })
  it('rechecks both copies before cleanup and retains changed sources', async () => {
    await fallback.backend.put('changed.jpg', Buffer.from('before'))
    await startStorageMigration()
    await waitForJob()
    await fallback.backend.put('changed.jpg', Buffer.from('after'))
    await startStorageMigration(fallback.fingerprint)
    expect((await waitForJob()).status).toBe('cleanup_failed')
    expect(await fallback.backend.stat('changed.jpg')).not.toBeNull()
  })
  it('resumes an interrupted matching configuration only', async () => {
    await fallback.backend.put('resume.jpg', Buffer.from('x'))
    await prisma.storageMigration.create({
      data: { source: fallback.fingerprint, destination: primary.fingerprint, status: 'running' },
    })
    await resumeStorageMigration()
    expect((await waitForJob()).status).toBe('verified')
    expect(await primary.backend.stat('resume.jpg')).not.toBeNull()
  })
  it('resumes cleanup after source deletion was committed but its item journal was interrupted', async () => {
    await fallback.backend.put('interrupted.jpg', Buffer.from('safe copy'))
    await startStorageMigration()
    const job = await waitForJob()
    await fallback.backend.delete('interrupted.jpg')
    await prisma.storageMigration.update({ where: { id: job.id }, data: { status: 'cleaning' } })
    await resumeStorageMigration()
    expect((await waitForJob()).status).toBe('cleaned')
    expect(
      (
        await prisma.storageMigrationItem.findUniqueOrThrow({
          where: { migrationId_key: { migrationId: job.id, key: 'interrupted.jpg' } },
        })
      ).status
    ).toBe('cleaned')
  })

  it('does not resume an interrupted job under different configuration', async () => {
    await prisma.storageMigration.create({
      data: { source: 'another-source', destination: primary.fingerprint, status: 'running' },
    })
    await resumeStorageMigration()
    expect(await prisma.storageMigration.count({ where: { source: fallback.fingerprint } })).toBe(0)
  })

  it('retains Upload authorization metadata when deletion fails', async () => {
    const { deleteUploadFiles } = await import('../src/services/uploads.js')
    const uuid = randomUUID()
    await prisma.upload.create({ data: { assetKey: uuid } })
    vi.spyOn(registry, 'getStorage').mockReturnValue(new registry.ApplicationStorage(primary, fallback))
    vi.spyOn(fallback.backend, 'delete').mockRejectedValue(new Error('Access denied'))
    await expect(deleteUploadFiles(`/uploads/${uuid}.jpg`)).rejects.toThrow('Access denied')
    expect(await prisma.upload.findUnique({ where: { assetKey: uuid } })).not.toBeNull()
  })

  it('serializes deletion and copy, keeping new primary uploads', async () => {
    await fallback.backend.put('deleted.jpg', Buffer.from('old'))
    const app = new registry.ApplicationStorage(primary, fallback)
    await startStorageMigration()
    await Promise.all([app.delete('deleted.jpg'), app.put('new.jpg', Buffer.from('new'))])
    await waitForJob()
    expect(await app.stat('deleted.jpg')).toBeNull()
    expect(await app.stat('new.jpg')).not.toBeNull()
  })
  it('fails visibly when fallback is unavailable and preserves the primary', async () => {
    await primary.backend.put('available.jpg', Buffer.from('x'))
    vi.spyOn(fallback.backend, 'get').mockRejectedValue(new Error('Access denied'))
    const app = new registry.ApplicationStorage(primary, fallback)
    const readable = await app.get('available.jpg')
    expect(readable).not.toBeNull()
    readable!.stream.destroy()
    await expect(app.get('missing.jpg')).rejects.toThrow('Access denied')
    vi.spyOn(fallback.backend, 'list').mockImplementation(function () {
      return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('offline')) }) }
    })
    await startStorageMigration()
    expect((await waitForJob()).status).toBe('failed')
    await expect(startStorageMigration(fallback.fingerprint)).rejects.toThrow()
  })
})

describe.skipIf(!process.env.TEST_S3_ENDPOINT)('bidirectional local / MinIO migration', () => {
  it.each(['to-s3', 'from-s3'])(
    '%s',
    async (direction) => {
      const options = {
        endpoint: process.env.TEST_S3_ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        bucket: `famlin-test-${randomUUID()}`,
        prefix: '',
        credentials: { accessKeyId: 'famlin-test', secretAccessKey: 'famlin-test-secret' },
      }
      const client = new S3Client(options)
      await client.send(new CreateBucketCommand({ Bucket: options.bucket }))
      const backend = new S3StorageBackend(options)
      const s3: StorageConfiguration = {
        backend,
        location: {
          driver: 's3',
          bucket: options.bucket,
          prefix: '',
          region: options.region,
          endpoint: options.endpoint,
          forcePathStyle: true,
        },
        fingerprint: options.bucket,
      }
      if (direction === 'to-s3') primary = s3
      else fallback = s3
      try {
        await fallback.backend.put('legacy.jpg', Buffer.from('legacy media'))
        await startStorageMigration()
        expect((await waitForJob()).status).toBe('verified')
        await startStorageMigration(fallback.fingerprint)
        expect((await waitForJob()).status).toBe('cleaned')
        expect(await fallback.backend.stat('legacy.jpg')).toBeNull()
        expect(await primary.backend.stat('legacy.jpg')).not.toBeNull()
      } finally {
        for await (const object of backend.list()) await backend.delete(object.key)
        await client.send(new DeleteBucketCommand({ Bucket: options.bucket }))
        client.destroy()
      }
    },
    60_000
  )
})
