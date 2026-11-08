import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { ZipArchive } from 'archiver'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { uploadsDir } from '../src/config.js'
import { getStorage } from '../src/services/storage/registry.js'
import { abortArchive, appendStoredObject, lazyStoredObjectStream } from '../src/services/storage/archive.js'
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
