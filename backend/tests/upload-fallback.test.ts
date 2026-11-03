import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { prisma } from '../src/db.js'
import { uploadsDir } from '../src/config.js'
import { buildTestApp, createUser, authHeader } from './helpers.js'

// Hold conversion so requests exercise pending/failed sources deterministically.
vi.mock('../src/services/uploadProcessing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/uploadProcessing.js')>()),
  startUploadWorker: () => async () => {},
}))

describe('legacy client media serving during conversion', () => {
  let app: FastifyInstance
  const keys: string[] = []
  beforeAll(async () => {
    app = await buildTestApp()
  })
  afterAll(async () => {
    await app.close()
  })
  afterEach(async () => {
    for (const key of keys.splice(0)) {
      await fs.rm(path.join(uploadsDir, 'originals', key), { recursive: true, force: true })
      for (const filename of await fs.readdir(uploadsDir)) {
        if (filename.startsWith(key)) await fs.unlink(path.join(uploadsDir, filename))
      }
    }
  })

  async function upload(filename: string, original: Buffer, member: Parameters<typeof authHeader>[0]) {
    const boundary = 'FamlinFallbackTest'
    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        ),
        original,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    })
    expect(response.statusCode).toBe(200)
    const url: string = response.json().urls[0]
    const key = path.basename(url).split('.')[0]
    keys.push(key)
    expect(await prisma.upload.findUniqueOrThrow({ where: { assetKey: key } })).toMatchObject({
      processingStatus: 'queued',
    })
    return { url, key }
  }

  for (const status of ['queued', 'processing', 'failed']) {
    it.each(['jpeg', 'png', 'webp'] as const)(
      `serves the original %s while ${status}, then switches to the converted file`,
      async (format) => {
        const member = await createUser()
        const original = await sharp({ create: { width: 12, height: 12, channels: 3, background: 'blue' } })
          .toFormat(format)
          .toBuffer()
        const { url, key } = await upload(`photo.${format}`, original, member)
        await prisma.upload.update({ where: { assetKey: key }, data: { processingStatus: status } })
        const response = await app.inject({ method: 'GET', url, headers: authHeader(member) })
        expect(response.statusCode).toBe(200)
        expect(response.rawPayload).toEqual(original)
        expect(response.headers['content-type']).toBe(`image/${format}`)
        expect(response.headers['cache-control']).toBe('no-store')
        const converted = Buffer.from('converted-image')
        await fs.writeFile(path.join(uploadsDir, path.basename(url)), converted)
        await prisma.upload.update({ where: { assetKey: key }, data: { processingStatus: 'ready' } })
        expect((await app.inject({ method: 'GET', url, headers: authHeader(member) })).rawPayload).toEqual(converted)
      }
    )

    it(`serves MOV with its real MIME type, byte ranges and HEAD while ${status}`, async () => {
      const member = await createUser()
      const original = Buffer.from('original-mov-source-bytes')
      const { url, key } = await upload('IMG_001.MOV', original, member)
      await prisma.upload.update({ where: { assetKey: key }, data: { processingStatus: status } })
      expect(url).toMatch(/\.mp4$/)
      const response = await app.inject({ method: 'GET', url, headers: authHeader(member) })
      expect(response.statusCode).toBe(200)
      expect(response.rawPayload).toEqual(original)
      expect(response.headers['content-type']).toBe('video/quicktime')
      expect(response.headers['cache-control']).toBe('no-store')
      const range = await app.inject({ method: 'GET', url, headers: { ...authHeader(member), range: 'bytes=2-7' } })
      expect(range.statusCode).toBe(206)
      expect(range.rawPayload).toEqual(original.subarray(2, 8))
      expect(range.headers['content-range']).toBe(`bytes 2-7/${original.length}`)
      expect(range.headers['cache-control']).toBe('no-store')
      const head = await app.inject({ method: 'HEAD', url, headers: authHeader(member) })
      expect(head.statusCode).toBe(200)
      expect(head.headers['content-length']).toBe(String(original.length))
      expect(head.rawPayload.length).toBe(0)
    })
  }

  it('serves a HEIC preview or its original without exposing private paths', async () => {
    const member = await createUser()
    const outsider = await createUser()
    const original = Buffer.from('undecodable-heic')
    const { url, key } = await upload('photo.heic', original, member)
    const thumbnail = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer()
    await fs.writeFile(path.join(uploadsDir, `${key}-thumbnail.jpg`), thumbnail)
    const preview = await app.inject({ method: 'GET', url, headers: authHeader(member) })
    expect(preview.statusCode).toBe(200)
    expect(preview.rawPayload).toEqual(thumbnail)
    expect(preview.headers['content-type']).toBe('image/jpeg')
    expect(preview.headers['cache-control']).toBe('no-store')
    await fs.unlink(path.join(uploadsDir, `${key}-thumbnail.jpg`))
    await prisma.upload.update({ where: { assetKey: key }, data: { processingStatus: 'failed' } })
    const fallback = await app.inject({ method: 'GET', url, headers: authHeader(member) })
    expect(fallback.statusCode).toBe(200)
    expect(fallback.rawPayload).toEqual(original)
    expect(fallback.headers['content-type']).toBe('image/heic')
    expect((await app.inject({ method: 'GET', url, headers: authHeader(outsider) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(
      (await app.inject({ method: 'GET', url: `/uploads/originals/${key}/photo.heic`, headers: authHeader(member) }))
        .statusCode
    ).toBe(404)
  })
})
