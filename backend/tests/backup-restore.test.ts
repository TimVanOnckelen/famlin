import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import fsp from 'fs/promises'
import path from 'path'
import { prisma } from '../src/db.js'
import { uploadsDir } from '../src/config.js'
import { BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR, backupDeps, runBackup } from '../src/services/backup/index.js'
import { BACKUP_UPLOADS_DIR } from '../src/services/backup/paths.js'
import { dumpFileName } from '../src/services/backup/dbDump.js'
import { pruneBackupArchives, backupArchiveFileName } from '../src/services/backup/archive.js'
import { restoreDumpDeps } from '../src/services/backup/restoreDump.js'
import { readLocalMigrations } from '../src/services/migrationGuard.js'
import { updateSettings } from '../src/services/settings.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost } from './helpers.js'

// Issue #461: a scheduled backup (zip + media mirror + pg_dump) restored
// from the setup screen of a wiped server, media included, without a shell.

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`)
}

async function clearBackups() {
  for (const name of await fsp.readdir(BACKUP_ARCHIVE_DIR).catch(() => [] as string[])) {
    await fsp.rm(path.join(BACKUP_ARCHIVE_DIR, name), { recursive: true, force: true })
  }
}

const PG_DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(32, 1)])

describe('restoring a backup from the backups volume', () => {
  let app: FastifyInstance
  let calls = 0

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await clearBackups()
    await app.close()
  })

  beforeEach(async () => {
    await truncateAll()
    await clearBackups()
    // CI's pg_dump client needn't match the server; the dump is a stand-in.
    vi.spyOn(backupDeps, 'dumpDatabase').mockImplementation(async (dir, now) => {
      await fsp.mkdir(dir, { recursive: true })
      const file = dumpFileName(now)
      await fsp.writeFile(path.join(dir, file), PG_DUMP)
      return { file, bytes: PG_DUMP.length }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function nextAddress() {
    calls += 1
    return `10.2.${Math.floor(calls / 250)}.${calls % 250}`
  }

  const list = () => app.inject({ method: 'GET', url: '/api/auth/setup/backups', remoteAddress: nextAddress() })
  const restore = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/auth/setup/restore-backup', payload, remoteAddress: nextAddress() })

  it('writes a zip next to the mirror and dump, then restores it with its media on a wiped server', async () => {
    const admin = await createUser({ isAdmin: true, email: 'admin@example.com', password: 'admin-password-1' })
    const member = await createUser({ email: 'member@example.com', password: 'member-password-1' })
    const group = await createGroupWithMember(admin)
    await addMember(group.id, member.id)
    const photo = `${crypto.randomUUID()}.jpg`
    await fsp.writeFile(path.join(uploadsDir, photo), 'family-photo')
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [`/uploads/${photo}`] })
    await updateSettings({ backupIncludeMedia: true, defaultLanguage: 'nl' })

    const result = await runBackup('manual', new Date('2026-11-10T03:00:00Z'))
    expect(result.archiveFile).toBe(backupArchiveFileName(new Date('2026-11-10T03:00:00Z')))
    expect(await fsp.readFile(path.join(BACKUP_UPLOADS_DIR, photo), 'utf8')).toBe('family-photo')

    // --- the server is lost: database and media -------------------------
    await truncateAll()
    await fsp.rm(path.join(uploadsDir, photo))

    const listed = await list()
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual([
      expect.objectContaining({
        name: result.archiveFile,
        type: 'archive',
        mediaLocation: 'mirror',
        credentials: true,
        valid: true,
        createdAt: '2026-11-10T03:00:00.000Z',
      }),
      expect.objectContaining({ name: result.dumpFile, type: 'dump', size: PG_DUMP.length }),
    ])

    const res = await restore({ file: result.archiveFile })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ restored: true, counts: { users: 2, posts: 1, mirroredFiles: 1 } })
    expect(res.json().token).toBeUndefined()

    expect(await fsp.readFile(path.join(uploadsDir, photo), 'utf8')).toBe('family-photo')
    expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull()
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'defaultLanguage' } })).value).toBe('nl')
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'member@example.com', password: 'member-password-1' },
    })
    expect(login.statusCode).toBe(200)

    // Nothing to list or restore once the server has accounts again.
    expect((await list()).statusCode).toBe(409)
    expect((await restore({ file: result.archiveFile })).statusCode).toBe(409)
    await fsp.rm(path.join(uploadsDir, photo), { force: true })
  })

  it('refuses when media are neither in storage nor in the mirror', async () => {
    const admin = await createUser({ isAdmin: true })
    await createGroupWithMember(admin)
    const photo = `${crypto.randomUUID()}.jpg`
    await fsp.writeFile(path.join(uploadsDir, photo), 'family-photo')
    // Media mirroring off: the zip expects them to still be in storage.
    await updateSettings({ backupIncludeMedia: false })
    const { archiveFile } = await runBackup('manual')
    await updateSettings({ backupIncludeMedia: true })
    await truncateAll()
    await fsp.rm(path.join(uploadsDir, photo))

    const res = await restore({ file: archiveFile })
    expect(res.statusCode).toBe(400)
    expect(res.json().missingMedia).toContain(photo)
    expect(await prisma.user.count()).toBe(0)
  })

  it('restores a legacy .dump from the same list through pg_restore', async () => {
    const local = await readLocalMigrations()
    vi.spyOn(restoreDumpDeps, 'readDumpMigrations').mockResolvedValue(local)
    vi.spyOn(restoreDumpDeps, 'replaceDatabase').mockImplementation(async () => {
      await createUser({ email: 'restored@example.com' })
    })
    vi.spyOn(restoreDumpDeps, 'migrateDeploy').mockResolvedValue()
    const name = dumpFileName(new Date('2026-11-09T03:00:00Z'))
    await fsp.mkdir(BACKUP_DB_DIR, { recursive: true })
    await fsp.writeFile(path.join(BACKUP_DB_DIR, name), PG_DUMP)

    const res = await restore({ file: name })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ restored: true, media: { restored: expect.any(Number) } })
    expect(restoreDumpDeps.replaceDatabase).toHaveBeenCalledWith(path.join(BACKUP_DB_DIR, name))
  })

  it.each([
    '../famlin-backup-2026-11-10T03-00-00-000Z.zip',
    'famlin-backup-2026-11-10T03-00-00-000Z.zip.partial',
    'famlin-backup-manual.zip',
    '/etc/passwd',
    '',
  ])('400s for a name that is not a backup in the volume: %j', async (file) => {
    const res = await restore({ file })
    expect(res.statusCode).toBe(400)
    expect(await prisma.user.count()).toBe(0)
  })

  it('400s for a well-formed archive name that is not in the volume', async () => {
    const res = await restore({ file: backupArchiveFileName(new Date()) })
    expect(res.statusCode).toBe(400)
  })

  it('lists an unreadable zip as invalid rather than hiding it', async () => {
    const name = backupArchiveFileName(new Date('2026-11-01T03:00:00Z'))
    await fsp.writeFile(path.join(BACKUP_ARCHIVE_DIR, name), 'not a zip')
    const res = await list()
    expect(res.json()).toEqual([expect.objectContaining({ name, type: 'archive', valid: false })])
  })
})

describe('pruneBackupArchives', () => {
  it('keeps the N newest archives, removes partial files, and leaves everything else alone', async () => {
    const dir = await fsp.mkdtemp(path.join(uploadsDir, '..', 'famlin-prune-'))
    try {
      const names = [0, 1, 2, 3].map((d) => backupArchiveFileName(new Date(Date.UTC(2026, 0, 1 + d, 3))))
      for (const name of names) await fsp.writeFile(path.join(dir, name), 'zip')
      await fsp.writeFile(path.join(dir, `${names[3]}.partial`), 'partial')
      await fsp.writeFile(path.join(dir, 'my-own-copy.zip'), 'keep me')
      await fsp.mkdir(path.join(dir, 'uploads'))

      const deleted = await pruneBackupArchives(dir, 2)

      expect(deleted).toHaveLength(3)
      expect((await fsp.readdir(dir)).sort()).toEqual([...names.slice(2), 'my-own-copy.zip', 'uploads'].sort())
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
