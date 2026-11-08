import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Readable, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { ZipArchive } from 'archiver'
import yauzl from 'yauzl'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { uploadsDir } from '../src/config.js'
import { getStorage } from '../src/services/storage/registry.js'
import { abortArchive, appendStoredObject, lazyStoredObjectStream } from '../src/services/storage/archive.js'
import { buildExportArchive } from '../src/services/export.js'
import { buildTestApp, createUser, authHeader } from './helpers.js'

// Stands in for storage: every get() hands out a fresh PassThrough the test
// can feed and inspect.
function fakeStorage() {
  const opened: PassThrough[] = []
  vi.spyOn(getStorage(), 'get').mockImplementation(async () => {
    const stream = new PassThrough()
    opened.push(stream)
    return { stream, size: 0, contentType: 'application/octet-stream' } as never
  })
  return opened
}

// Storage whose objects are small finished streams; a key in `missing` is
// gone (get() → null), like a file deleted mid-export.
function finiteStorage(missing: Set<string> = new Set()) {
  vi.spyOn(getStorage(), 'get').mockImplementation(async (key) => {
    if (missing.has(key)) return null
    return { stream: Readable.from([Buffer.from(`contents of ${key}`)]), size: 0 } as never
  })
}

function zipEntryNames(zip: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, file) => {
      if (err || !file) return reject(err)
      const names: string[] = []
      file.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName)
        file.readEntry()
      })
      file.on('end', () => resolve(names))
      file.on('error', reject)
      file.readEntry()
    })
  })
}

function collect(archive: ZipArchive): Promise<Buffer> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
  })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stored-object archive entries', () => {
  it('destroys the underlying object stream when the entry is destroyed mid-read', async () => {
    const opened = fakeStorage()
    const entry = lazyStoredObjectStream('a.jpg')
    entry.on('data', () => {})
    await tick()
    expect(opened).toHaveLength(1)
    opened[0].write('some bytes')
    await tick()

    entry.destroy()
    await tick()
    expect(opened[0].destroyed).toBe(true)
  })

  it('never opens an object for an entry destroyed before it was read', async () => {
    const opened = fakeStorage()
    lazyStoredObjectStream('a.jpg').destroy()
    await tick()
    expect(opened).toHaveLength(0)
  })

  it('opens only a few objects at a time and closes them all on abort', async () => {
    const opened = fakeStorage()
    const archive = new ZipArchive({ store: true })
    // A consumer that never reads, like a stalled client.
    archive.pipe(new Writable({ highWaterMark: 1, write: () => {} }))
    archive.on('error', () => {})
    for (let i = 0; i < 20; i++) appendStoredObject(archive, `${i}.jpg`)
    void archive.finalize().catch(() => {})
    await tick()
    expect(opened.length).toBeGreaterThan(0)
    expect(opened.length).toBeLessThanOrEqual(4)

    abortArchive(archive)
    await tick()
    expect(opened.every((stream) => stream.destroyed)).toBe(true)
  })

  it('completes an archive with more entries than open slots', async () => {
    finiteStorage()
    const archive = new ZipArchive({ store: true })
    const zip = collect(archive)
    for (let i = 0; i < 20; i++) appendStoredObject(archive, `${i}.jpg`)
    await archive.finalize()
    const names = await zipEntryNames(await zip)
    expect(names.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `uploads/${i}.jpg`).sort())
  })

  it('fails the archive instead of crashing when an object is missing', async () => {
    finiteStorage(new Set(['3.jpg']))
    const archive = new ZipArchive({ store: true })
    const zip = collect(archive)
    for (let i = 0; i < 8; i++) appendStoredObject(archive, `${i}.jpg`)
    void archive.finalize().catch(() => {})
    await expect(zip).rejects.toThrow('Export media disappeared')
    expect(archive.destroyed).toBe(true)
  })

  it('closes open sources when the archive is destroyed before it is consumed', async () => {
    // Fastify destroys the response stream (the archive) when the client goes
    // away, possibly before anything was read or finalize() was called.
    const opened = fakeStorage()
    const archive = new ZipArchive({ store: true })
    archive.on('error', () => {})
    for (let i = 0; i < 6; i++) appendStoredObject(archive, `${i}.jpg`)
    await tick()
    expect(opened.length).toBeGreaterThan(0)
    archive.destroy()
    await tick()
    expect(opened.every((stream) => stream.destroyed)).toBe(true)
  })
})

describe('buildExportArchive media errors', () => {
  it('reports a missing object through onError', async () => {
    const keys = Array.from({ length: 3 }, () => `${randomUUID()}.jpg`)
    await Promise.all(keys.map((key) => fs.writeFile(path.join(uploadsDir, key), 'x')))
    const realGet = getStorage().get.bind(getStorage())
    vi.spyOn(getStorage(), 'get').mockImplementation(async (key, options) =>
      key === keys[1] ? null : realGet(key, options)
    )
    try {
      const errors: Error[] = []
      const archive = await buildExportArchive(true, (err) => errors.push(err))
      archive.resume()
      void archive.finalize().catch(() => {})
      await vi.waitFor(() => expect(errors.map((err) => err.message)).toContain('Export media disappeared'))
    } finally {
      await Promise.all(keys.map((key) => fs.rm(path.join(uploadsDir, key), { force: true })))
    }
  })
})

describe('GET /api/admin/export client disconnect', () => {
  it('aborts the archive and closes open storage streams', async () => {
    const keys = Array.from({ length: 6 }, () => `${randomUUID()}.jpg`)
    await Promise.all(keys.map((key) => fs.writeFile(path.join(uploadsDir, key), Buffer.alloc(256 * 1024, 1))))
    const app = await buildTestApp()
    const realGet = getStorage().get.bind(getStorage())
    const opened: NodeJS.ReadableStream[] = []
    vi.spyOn(getStorage(), 'get').mockImplementation(async (key, options) => {
      const object = await realGet(key, options)
      if (object) opened.push(object.stream)
      return object
    })
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const admin = await createUser({ isAdmin: true })

      await new Promise<void>((resolve, reject) => {
        const req = http.get({ port, path: '/api/admin/export', headers: authHeader(admin) }, (res) => {
          expect(res.statusCode).toBe(200)
          res.once('data', () => {
            req.destroy()
            resolve()
          })
        })
        req.on('error', (err) => (err.message === 'socket hang up' ? undefined : reject(err)))
      })

      await vi.waitFor(() => {
        expect(opened.length).toBeGreaterThan(0)
        expect(opened.every((stream) => (stream as unknown as { destroyed: boolean }).destroyed)).toBe(true)
      })
    } finally {
      await app.close()
      await Promise.all(keys.map((key) => fs.rm(path.join(uploadsDir, key), { force: true })))
    }
  })
})

describe('GET /api/admin/export missing media', () => {
  it('cuts the response off instead of crashing the server', async () => {
    const keys = Array.from({ length: 6 }, () => `${randomUUID()}.jpg`)
    await Promise.all(keys.map((key) => fs.writeFile(path.join(uploadsDir, key), Buffer.alloc(64 * 1024, 1))))
    const app = await buildTestApp()
    const realGet = getStorage().get.bind(getStorage())
    // The missing object is noticed only once the response is streaming.
    vi.spyOn(getStorage(), 'get').mockImplementation(async (key, options) => {
      if (key !== keys[2]) return realGet(key, options)
      await new Promise((resolve) => setTimeout(resolve, 200))
      return null
    })
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo
      const admin = await createUser({ isAdmin: true })

      const outcome = await new Promise<string>((resolve) => {
        const req = http.get({ port, path: '/api/admin/export', headers: authHeader(admin) }, (res) => {
          expect(res.statusCode).toBe(200)
          res.resume()
          res.on('end', () => resolve(res.complete ? 'complete' : 'aborted'))
          res.on('aborted', () => resolve('aborted'))
          res.on('error', () => resolve('aborted'))
        })
        req.on('error', () => resolve('aborted'))
      })
      expect(outcome).toBe('aborted')

      const health = await app.inject({ method: 'GET', url: '/api/auth/setup-status' })
      expect(health.statusCode).toBe(200)
    } finally {
      await app.close()
      await Promise.all(keys.map((key) => fs.rm(path.join(uploadsDir, key), { force: true })))
    }
  })
})
