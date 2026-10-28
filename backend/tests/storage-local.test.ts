import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { LocalStorageBackend, getStorage } from '../src/services/storage/index.js'
import { getStorageConfiguration } from '../src/services/storage/registry.js'
import { uploadsDir } from '../src/config.js'
import { runStorageBackendContract } from './storage/contract.js'

let root: string | null = null

runStorageBackendContract('local', {
  async create() {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-storage-'))
    // A not-yet-existing subdirectory, so init() is what creates it.
    return new LocalStorageBackend(path.join(root, 'uploads'))
  },
  async cleanup() {
    if (root) await fsp.rm(root, { recursive: true, force: true })
    root = null
  },
})

describe('LocalStorageBackend specifics', () => {
  let dir: string
  let storage: LocalStorageBackend

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-storage-'))
    storage = new LocalStorageBackend(dir)
    await storage.init()
  })

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  // Existing deployments switch to this driver with no migration: a key is
  // exactly the file's path under the uploads directory, both ways.
  it('maps keys to plain files at the same relative path', async () => {
    await storage.put('originals/abc.heic', Buffer.from('orig'))
    await expect(fsp.readFile(path.join(dir, 'originals', 'abc.heic'), 'utf8')).resolves.toBe('orig')

    await fsp.writeFile(path.join(dir, 'legacy.jpg'), 'pre-existing')
    expect(await storage.stat('legacy.jpg')).toMatchObject({ size: 12 })
  })

  it('leaves no temp files behind and hides dotfiles from list()', async () => {
    await storage.put('a.jpg', Buffer.from('a'))
    await fsp.mkdir(path.join(dir, '.restore-123'))
    await fsp.writeFile(path.join(dir, '.restore-123', 'x.jpg'), 'x')
    await fsp.writeFile(path.join(dir, '.DS_Store'), 'x')
    await fsp.writeFile(path.join(dir, 'has space.jpg'), 'x')

    expect((await fsp.readdir(dir)).filter((f) => f.startsWith('.tmp-'))).toEqual([])
    const keys: string[] = []
    for await (const info of storage.list()) keys.push(info.key)
    expect(keys).toEqual(['a.jpg'])
  })

  it('cleans up its temp file when a write fails', async () => {
    await expect(storage.put('a.jpg', { filePath: path.join(dir, 'does-not-exist') })).rejects.toThrow()
    expect(await fsp.readdir(dir)).toEqual([])
  })

  it('neither serves nor lists symlinks', async () => {
    const outside = path.join(dir, '..', `${path.basename(dir)}-outside.jpg`)
    await fsp.writeFile(outside, 'secret')
    try {
      await fsp.symlink(outside, path.join(dir, 'link.jpg'))
      expect(await storage.stat('link.jpg')).toBeNull()
      expect(await storage.get('link.jpg')).toBeNull()
      const keys: string[] = []
      for await (const info of storage.list()) keys.push(info.key)
      expect(keys).toEqual([])
    } finally {
      await fsp.rm(outside, { force: true })
    }
  })

  it('keeps streaming a file deleted after get() resolved', async () => {
    await storage.put('a.jpg', Buffer.from('still here'))
    const object = await storage.get('a.jpg')
    await storage.delete('a.jpg')
    const chunks: Buffer[] = []
    for await (const chunk of object!.stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('still here')
  })

  it('treats a directory as a missing object', async () => {
    await fsp.mkdir(path.join(dir, 'originals'))
    expect(await storage.stat('originals')).toBeNull()
    expect(await storage.get('originals')).toBeNull()
  })

  it('is the default driver, rooted at UPLOADS_DIR', () => {
    const active = getStorage()
    expect(active.id).toBe('local')
    expect(getStorageConfiguration().primary.location).toEqual({ driver: 'local', directory: uploadsDir })
  })
})
