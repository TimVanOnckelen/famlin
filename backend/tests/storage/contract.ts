import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import Fastify from 'fastify'
import { sendStoredObject, StorageError, type StorageBackend } from '../../src/services/storage/index.js'

// The behavior every StorageBackend driver must share (issue #221). Each
// driver's test file calls this with a factory for a fresh, empty backend —
// `local` against a temp dir today; `s3` against MinIO and `azure` against
// Azurite once those drivers land — so the drivers can't drift apart.
export interface ContractHarness {
  create(): Promise<StorageBackend>
  cleanup?(): Promise<void>
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function listKeys(storage: StorageBackend, prefix?: string): Promise<string[]> {
  const keys: string[] = []
  for await (const info of storage.list(prefix)) keys.push(info.key)
  return keys.sort()
}

export function runStorageBackendContract(name: string, harness: ContractHarness): void {
  describe(`StorageBackend contract: ${name}`, () => {
    let storage: StorageBackend

    beforeEach(async () => {
      storage = await harness.create()
      await storage.init()
    })

    afterEach(async () => {
      await harness.cleanup?.()
    })

    it('is writable after init()', async () => {
      expect(await storage.isWritable()).toBe(true)
    })

    it('round-trips a Buffer, a stream and a local file', async () => {
      await storage.put('a.jpg', Buffer.from('buffer body'))
      await storage.put('b.jpg', Readable.from([Buffer.from('stream '), Buffer.from('body')]))
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-storage-src-'))
      try {
        await fsp.writeFile(path.join(tmp, 'src.jpg'), 'file body')
        await storage.put('c.jpg', { filePath: path.join(tmp, 'src.jpg') })
        // The source file is copied, not consumed.
        await expect(fsp.readFile(path.join(tmp, 'src.jpg'), 'utf8')).resolves.toBe('file body')
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true })
      }

      for (const [key, body] of [
        ['a.jpg', 'buffer body'],
        ['b.jpg', 'stream body'],
        ['c.jpg', 'file body'],
      ]) {
        const object = await storage.get(key)
        expect(object).not.toBeNull()
        expect(object!.size).toBe(body.length)
        expect(object!.range).toBeNull()
        expect((await readAll(object!.stream)).toString()).toBe(body)
      }
    })

    it('stores nested keys under their prefix', async () => {
      await storage.put('originals/x.heic', Buffer.from('orig'))
      await storage.put('derived/x-thumbnail.jpg', Buffer.from('thumb'))
      const object = await storage.get('originals/x.heic')
      expect((await readAll(object!.stream)).toString()).toBe('orig')
    })

    it('overwrites an existing key', async () => {
      await storage.put('a.jpg', Buffer.from('first version'))
      await storage.put('a.jpg', Buffer.from('second'))
      const object = await storage.get('a.jpg')
      expect(object!.size).toBe(6)
      expect((await readAll(object!.stream)).toString()).toBe('second')
    })

    it('returns null / no-ops for a missing key', async () => {
      expect(await storage.get('missing.jpg')).toBeNull()
      expect(await storage.stat('missing.jpg')).toBeNull()
      expect(await storage.stat('nested/missing.jpg')).toBeNull()
      await expect(storage.delete('missing.jpg')).resolves.toBeUndefined()
    })

    it('stat() reports size and last modification', async () => {
      const before = Date.now() - 5000
      await storage.put('a.jpg', Buffer.from('12345'))
      const info = await storage.stat('a.jpg')
      expect(info).toMatchObject({ key: 'a.jpg', size: 5 })
      expect(info!.lastModified.getTime()).toBeGreaterThan(before)
    })

    it('deletes a key', async () => {
      await storage.put('a.jpg', Buffer.from('x'))
      await storage.delete('a.jpg')
      expect(await storage.stat('a.jpg')).toBeNull()
    })

    it('reads byte ranges, clamping an end past the object', async () => {
      await storage.put('v.mp4', Buffer.from('0123456789'))

      const mid = await storage.get('v.mp4', { range: { start: 2, end: 5 } })
      expect(mid!.range).toEqual({ start: 2, end: 5 })
      expect(mid!.size).toBe(10)
      expect((await readAll(mid!.stream)).toString()).toBe('2345')

      const open = await storage.get('v.mp4', { range: { start: 7 } })
      expect(open!.range).toEqual({ start: 7, end: 9 })
      expect((await readAll(open!.stream)).toString()).toBe('789')

      const clamped = await storage.get('v.mp4', { range: { start: 8, end: 100 } })
      expect(clamped!.range).toEqual({ start: 8, end: 9 })
      expect((await readAll(clamped!.stream)).toString()).toBe('89')
    })

    it('rejects unsatisfiable ranges', async () => {
      await storage.put('v.mp4', Buffer.from('0123456789'))
      for (const range of [{ start: 10 }, { start: 5, end: 4 }, { start: -1 }]) {
        await expect(storage.get('v.mp4', { range })).rejects.toMatchObject({ code: 'invalid_range' })
      }
    })

    it('lists every key, optionally narrowed by prefix', async () => {
      await storage.put('a.jpg', Buffer.from('a'))
      await storage.put('a-thumbnail.jpg', Buffer.from('at'))
      await storage.put('b.jpg', Buffer.from('b'))
      await storage.put('originals/a.heic', Buffer.from('ao'))
      await storage.put('derived/a.jpg', Buffer.from('ad'))

      expect(await listKeys(storage)).toEqual([
        'a-thumbnail.jpg',
        'a.jpg',
        'b.jpg',
        'derived/a.jpg',
        'originals/a.heic',
      ])
      expect(await listKeys(storage, 'originals/')).toEqual(['originals/a.heic'])
      expect(await listKeys(storage, 'a')).toEqual(['a-thumbnail.jpg', 'a.jpg'])
      expect(await listKeys(storage, 'nothing-here/')).toEqual([])

      for await (const info of storage.list('b')) {
        expect(info).toMatchObject({ key: 'b.jpg', size: 1 })
        expect(info.lastModified).toBeInstanceOf(Date)
      }
    })

    it('rejects keys that could escape the storage root', async () => {
      for (const key of ['', '/abs.jpg', '../escape.jpg', 'a/../../b.jpg', 'a//b.jpg', 'a\\b.jpg', './a.jpg', 'a/']) {
        await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(StorageError)
        await expect(storage.get(key)).rejects.toBeInstanceOf(StorageError)
        await expect(storage.stat(key)).rejects.toBeInstanceOf(StorageError)
        await expect(storage.delete(key)).rejects.toBeInstanceOf(StorageError)
      }
      await expect(async () => {
        for await (const _ of storage.list('../')) void _
      }).rejects.toBeInstanceOf(StorageError)
    })

    describe('served through sendStoredObject', () => {
      async function serve(headers: Record<string, string> = {}, key = 'v.mp4') {
        const app = Fastify()
        app.get('/f', async (_request, reply) => {
          if (await sendStoredObject(reply, storage, key, { contentType: 'video/mp4', rangeHeader: headers.range })) {
            return reply
          }
          return reply.status(404).send({ error: 'not found' })
        })
        try {
          return await app.inject({ method: 'GET', url: '/f', headers })
        } finally {
          await app.close()
        }
      }

      beforeEach(async () => {
        await storage.put('v.mp4', Buffer.from('0123456789'))
      })

      it('sends the whole object with 200', async () => {
        const res = await serve()
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('0123456789')
        expect(res.headers['content-length']).toBe('10')
        expect(res.headers['content-type']).toBe('video/mp4')
        expect(res.headers['accept-ranges']).toBe('bytes')
      })

      it('answers a Range request with 206', async () => {
        const res = await serve({ range: 'bytes=2-4' })
        expect(res.statusCode).toBe(206)
        expect(res.body).toBe('234')
        expect(res.headers['content-range']).toBe('bytes 2-4/10')
        expect(res.headers['content-length']).toBe('3')

        const suffix = await serve({ range: 'bytes=-3' })
        expect(suffix.statusCode).toBe(206)
        expect(suffix.body).toBe('789')
      })

      it('answers an unsatisfiable Range with 416', async () => {
        const res = await serve({ range: 'bytes=20-' })
        expect(res.statusCode).toBe(416)
        expect(res.headers['content-range']).toBe('bytes */10')
      })

      it('ignores a Range form it does not support', async () => {
        const res = await serve({ range: 'bytes=0-1,4-5' })
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('0123456789')
      })

      it('leaves a missing object to the caller', async () => {
        const res = await serve({}, 'missing.mp4')
        expect(res.statusCode).toBe(404)
      })
    })
  })
}
