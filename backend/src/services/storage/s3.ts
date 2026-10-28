import fs from 'node:fs'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {
  StorageError,
  assertValidStorageKey,
  resolveByteRange,
  type StorageBackend,
  type StorageBody,
  type ByteRange,
  type StoredObjectInfo,
  type StoredObject,
} from './types.js'

export interface S3Options {
  bucket: string
  prefix: string
  endpoint?: string
  region: string
  forcePathStyle: boolean
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
}

// ETags are deliberately never interpreted as content hashes.
export class S3StorageBackend implements StorageBackend {
  readonly id = 's3'
  private readonly client: S3Client
  constructor(readonly options: S3Options) {
    this.client = new S3Client(options)
  }
  private key(key: string): string {
    assertValidStorageKey(key)
    return this.options.prefix + key
  }
  async init(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }))
    } catch (error) {
      throw safeError(error)
    }
  }
  async isWritable(): Promise<boolean> {
    const key = `internal/health-${randomUUID()}`
    try {
      await this.put(key, Buffer.alloc(0))
      await this.delete(key)
      return true
    } catch {
      return false
    }
  }
  async put(key: string, body: StorageBody): Promise<void> {
    const input = !Buffer.isBuffer(body) && 'filePath' in body ? fs.createReadStream(body.filePath) : body
    const stream =
      Buffer.isBuffer(input) || input instanceof Readable
        ? input
        : Symbol.asyncIterator in input
          ? Readable.from(input)
          : new Readable().wrap(input)
    try {
      await new Upload({
        client: this.client,
        params: { Bucket: this.options.bucket, Key: this.key(key), Body: stream },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      }).done()
    } catch (error) {
      throw safeError(error)
    } finally {
      if (stream instanceof Readable) stream.destroy()
    }
  }
  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }))
      return { key, size: result.ContentLength!, lastModified: result.LastModified! }
    } catch (error) {
      if (missing(error)) return null
      throw safeError(error)
    }
  }
  async get(key: string, options?: { range?: ByteRange }): Promise<StoredObject | null> {
    // Resolve suffix/clamped ranges consistently with the local driver. Use
    // IfMatch to reject an object replaced between HEAD and GET.
    const objectKey = this.key(key)
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }))
      const size = head.ContentLength!
      const range = options?.range ? resolveByteRange(options.range, size) : null
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
          IfMatch: head.ETag,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        })
      )
      if (!(result.Body instanceof Readable)) throw new Error('S3 returned no readable body')
      return { key, size, lastModified: head.LastModified!, range, stream: result.Body }
    } catch (error) {
      if (missing(error)) return null
      throw safeError(error)
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.key(key) }))
    } catch (error) {
      throw safeError(error)
    }
  }
  async *list(): AsyncIterable<StoredObjectInfo> {
    let token: string | undefined
    do {
      const page = await safeRequest(() =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.options.bucket,
            Prefix: this.options.prefix,
            ContinuationToken: token,
          })
        )
      )
      for (const entry of page.Contents ?? []) {
        const key = entry.Key!.slice(this.options.prefix.length)
        try {
          assertValidStorageKey(key)
        } catch {
          continue
        }
        yield { key, size: entry.Size!, lastModified: entry.LastModified! }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
      if (page.IsTruncated && !token) throw new Error('S3 listing has no continuation token')
    } while (token)
  }
}
function missing(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e.$metadata?.httpStatusCode === 404 && (e.name === 'NotFound' || e.name === 'NoSuchKey')
}

// SDK/provider errors may echo request details. Only status/category crosses
// this boundary, so API errors, job history and logs never expose credentials.
function safeError(error: unknown): Error {
  if (error instanceof StorageError) return error
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  return new Error(
    status === 401 || status === 403
      ? 'S3 storage access denied'
      : `S3 storage request failed${status ? ` (HTTP ${status})` : ''}`
  )
}
async function safeRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    throw safeError(error)
  }
}
