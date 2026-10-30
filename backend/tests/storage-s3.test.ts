import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { S3StorageBackend } from '../src/services/storage/s3.js'
import { runStorageBackendContract } from './storage/contract.js'

const endpoint = process.env.TEST_S3_ENDPOINT
const options = {
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  prefix: '',
  bucket: `famlin-test-${randomUUID()}`,
  credentials: { accessKeyId: 'famlin-test', secretAccessKey: 'famlin-test-secret' },
}

describe.skipIf(!endpoint)('S3 against isolated MinIO', () => {
  const client = new S3Client(options)
  const storage = new S3StorageBackend(options)
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: options.bucket }))
  })
  afterAll(async () => {
    for await (const object of storage.list()) await storage.delete(object.key)
    await client.send(new DeleteBucketCommand({ Bucket: options.bucket }))
    client.destroy()
  })
  runStorageBackendContract('s3', {
    async create() {
      return new S3StorageBackend({ ...options, prefix: `contract-${randomUUID()}/` })
    },
    async cleanup() {
      for await (const object of storage.list()) await storage.delete(object.key)
    },
  })
  it('uploads a multipart stream without collecting the entire input', async () => {
    const part = Buffer.alloc(1024 * 1024, 73)
    await storage.put(
      'large.mp4',
      Readable.from(
        (async function* () {
          for (let i = 0; i < 25; i++) yield part
        })()
      )
    )
    const result = await storage.get('large.mp4')
    let bytes = 0
    for await (const chunk of result!.stream) {
      expect(Buffer.from(chunk).every((b) => b === 73)).toBe(true)
      bytes += chunk.length
    }
    expect(bytes).toBe(25 * part.length)
  }, 60_000)
  it('lists multiple pages', async () => {
    for (let batch = 0; batch < 11; batch++) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => storage.put(`page-${batch}-${i}.jpg`, Buffer.from('x'))))
    }
    let count = 0
    for await (const object of storage.list()) if (object.key.startsWith('page-')) count++
    expect(count).toBe(1100)
  }, 120_000)
  it('does not interpret access denied as missing', async () => {
    const denied = new S3StorageBackend({
      ...options,
      credentials: { accessKeyId: 'not-a-user', secretAccessKey: 'not-a-secret' },
    })
    await expect(denied.stat('secret.jpg')).rejects.toThrow()
    await expect(denied.get('secret.jpg')).rejects.toThrow()
  })
})
