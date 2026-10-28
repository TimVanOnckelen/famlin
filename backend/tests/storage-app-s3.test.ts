import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { prisma } from '../src/db.js'
import { S3StorageBackend } from '../src/services/storage/s3.js'
import { LocalStorageBackend } from '../src/services/storage/local.js'
import * as registry from '../src/services/storage/registry.js'
import { restoreArchive } from '../src/services/import.js'
import { mirrorUploads } from '../src/services/backup/mirror.js'
import { deleteUploadFiles } from '../src/services/uploads.js'
import { buildTestApp, createUser, authHeader, createGroupWithMember, createPost } from './helpers.js'

function multipart(filename: string, body: Buffer) {
  const boundary = 'famlin-s3-test-boundary'
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  }
}

describe.skipIf(!process.env.TEST_S3_ENDPOINT)('S3 application media workflows', () => {
  const options = {
    endpoint: process.env.TEST_S3_ENDPOINT,
    bucket: `famlin-test-${randomUUID()}`,
    prefix: 'media/',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'famlin-test', secretAccessKey: 'famlin-test-secret' },
  }
  const client = new S3Client(options)
  const s3 = new S3StorageBackend(options)
  let app: FastifyInstance
  let dir: string
  let local: LocalStorageBackend
  let storage: registry.ApplicationStorage
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-s3-app-test-'))
    local = new LocalStorageBackend(path.join(dir, 'fallback'))
    await local.init()
    await client.send(new CreateBucketCommand({ Bucket: options.bucket }))
    const primary = {
      backend: s3,
      fingerprint: options.bucket,
      location: {
        driver: 's3' as const,
        bucket: options.bucket,
        prefix: options.prefix,
        endpoint: options.endpoint,
        region: options.region,
        forcePathStyle: true,
      },
    }
    const fallback = {
      backend: local,
      fingerprint: local.rootDir,
      location: { driver: 'local' as const, directory: local.rootDir },
    }
    storage = new registry.ApplicationStorage(primary, fallback)
    vi.spyOn(registry, 'getStorage').mockReturnValue(storage)
    vi.spyOn(registry, 'getStorageConfiguration').mockReturnValue({ primary, fallback })
    app = await buildTestApp()
  })
  afterAll(async () => {
    await app?.close()
    vi.restoreAllMocks()
    for await (const object of s3.list()) await s3.delete(object.key)
    await client.send(new DeleteBucketCommand({ Bucket: options.bucket }))
    client.destroy()
    await fs.rm(dir, { recursive: true, force: true })
  })
  it('uploads images, serves authorized variants, keeps originals private and deletes both stores', async () => {
    const owner = await createUser()
    const other = await createUser()
    const input = await sharp({ create: { width: 2100, height: 1500, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer()
    const request = multipart('photo.jpg', input)
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      ...request,
      headers: { ...request.headers, ...authHeader(owner) },
    })
    expect(uploaded.statusCode).toBe(200)
    const url = uploaded.json().urls[0] as string
    const key = url.slice('/uploads/'.length),
      uuid = key.slice(0, -4)
    expect(await s3.stat(`originals/${key}`)).not.toBeNull()
    expect(await s3.stat(`${uuid}-thumbnail.jpg`)).not.toBeNull()
    expect((await app.inject({ method: 'GET', url, headers: authHeader(other) })).statusCode).toBe(404)
    const served = await app.inject({ method: 'GET', url, headers: authHeader(owner) })
    expect(served.statusCode).toBe(200)
    expect((await sharp(served.rawPayload).metadata()).width).toBe(1920)
    expect(
      (await app.inject({ method: 'GET', url: `/uploads/originals/${key}`, headers: authHeader(owner) })).statusCode
    ).toBe(404)
    await local.put(key, input)
    await deleteUploadFiles(url)
    expect(await s3.stat(key)).toBeNull()
    expect(await local.stat(key)).toBeNull()
    expect(await prisma.upload.findUnique({ where: { assetKey: uuid } })).toBeNull()
  })
  it('serves video ranges and HEAD through fallback without confusing access errors with absence', async () => {
    const owner = await createUser()
    const request = multipart('clip.mp4', Buffer.from('0123456789'))
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      ...request,
      headers: { ...request.headers, ...authHeader(owner) },
    })
    expect(uploaded.statusCode).toBe(200)
    const url = uploaded.json().urls[0] as string,
      key = url.slice('/uploads/'.length)
    await local.put(key, Buffer.from('0123456789'))
    await s3.delete(key)
    const range = await app.inject({ method: 'GET', url, headers: { ...authHeader(owner), range: 'bytes=2-4' } })
    expect(range.statusCode).toBe(206)
    expect(range.body).toBe('234')
    expect(range.headers['content-type']).toBe('video/mp4')
    const head = await app.inject({ method: 'HEAD', url, headers: authHeader(owner) })
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['content-length']).toBe('10')
    expect(
      (await app.inject({ method: 'GET', url, headers: { ...authHeader(owner), range: 'bytes=99-' } })).statusCode
    ).toBe(416)
    const fail = vi.spyOn(s3, 'get').mockRejectedValueOnce(new Error('Access denied'))
    expect((await app.inject({ method: 'GET', url, headers: authHeader(owner) })).statusCode).toBe(500)
    fail.mockRestore()
  })
  it('materializes legacy HEIC in scratch space and stores its cache in S3', async () => {
    const owner = await createUser(),
      uuid = randomUUID()
    const input = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'blue' } })
      .jpeg()
      .toBuffer()
    // sharp sniffs bytes: a JPEG under an old HEIC key exercises the same
    // materialization/cache path without requiring a system HEIF decoder.
    await local.put(`${uuid}.heic`, input)
    const res = await app.inject({ method: 'GET', url: `/uploads/${uuid}.heic`, headers: authHeader(owner) })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(await s3.stat(`derived/${uuid}.jpg`)).not.toBeNull()
    expect(await s3.stat(`derived/${uuid}-thumbnail.jpg`)).not.toBeNull()
  })
  it('exports primary/fallback media for admins and members, mirrors once, and restores into S3', async () => {
    const admin = await createUser({ isAdmin: true }),
      group = await createGroupWithMember(admin)
    const uuid = randomUUID(),
      key = `${uuid}.gif`
    await local.put(key, Buffer.from('fallback-export-media'))
    await createPost({ authorId: admin.id, groupId: group.id, uploadedAssetUrls: [`/uploads/${key}`] })
    const full = await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) })
    expect(full.statusCode).toBe(200)
    expect(full.rawPayload.toString()).toContain('fallback-export-media')
    const member = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(admin) })
    expect(member.statusCode).toBe(200)
    expect(member.rawPayload.toString()).toContain('fallback-export-media')
    await s3.put(key, Buffer.from('fallback-export-media'))
    const mirrored = await mirrorUploads(storage, path.join(dir, 'mirror'), new Date())
    expect(mirrored.fileCount).toBeGreaterThan(0)
    expect(await fs.readFile(path.join(dir, 'mirror', key), 'utf8')).toBe('fallback-export-media')
    const archivePath = path.join(dir, 'full.zip')
    await fs.writeFile(archivePath, full.rawPayload)
    const tables = await prisma.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`
    )
    await restoreArchive({
      zipPath: archivePath,
      workDir: path.join(dir, 'restore'),
      admin: { email: 'restored@test.invalid', name: 'Restored', passwordHash: 'not-a-real-password' },
      lockKey: 999221n,
    })
    const object = await s3.get(key)
    expect(object).not.toBeNull()
    const chunks: Buffer[] = []
    for await (const chunk of object!.stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('fallback-export-media')
  })
})
