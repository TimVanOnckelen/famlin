import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import fsp from 'fs/promises'
import path from 'path'
import { prisma } from '../src/db.js'
import { randomUUID } from 'crypto'
import { BACKUP_DB_DIR, BACKUP_UPLOADS_DIR } from '../src/services/backup/index.js'
import { uploadsDir } from '../src/config.js'
import { PgToolNotInstalledError, runPgTool } from '../src/services/backup/dbDump.js'
import { parseDumpMigrations, restoreDumpDeps, RestoreDumpError } from '../src/services/backup/restoreDump.js'
import { MigrateDeployError, readLocalMigrations } from '../src/services/migrationGuard.js'
import { getAllSettings, updateSettings } from '../src/services/settings.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'

// pg_restore and `prisma migrate deploy` are stubbed through restoreDumpDeps:
// a real restore would replace the shared test database.

const DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(64, 1)])
const OLDER = 'famlin-2026-10-19T03-00-00-000Z.dump'
const NEWER = 'famlin-2026-10-20T03-00-00-000Z.dump'

async function putDump(name: string, content: Buffer = DUMP) {
  await fsp.mkdir(BACKUP_DB_DIR, { recursive: true })
  await fsp.writeFile(path.join(BACKUP_DB_DIR, name), content)
}

describe('parseDumpMigrations', () => {
  it('reads applied migration names from the COPY block, skipping unfinished and rolled-back ones', () => {
    const sql = [
      '-- PostgreSQL database dump',
      'COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;',
      'a\tx\t2026-01-01 00:00:00+00\t20260101_init\t\\N\t\\N\t2026-01-01 00:00:00+00\t1',
      'b\tx\t\\N\t20260102_failed\t\\N\t\\N\t2026-01-02 00:00:00+00\t0',
      'c\tx\t2026-01-03 00:00:00+00\t20260103_rolled\t\\N\t2026-01-03 00:00:00+00\t2026-01-03 00:00:00+00\t0',
      'd\tx\t2026-01-04 00:00:00+00\t20260104_second\t\\N\t\\N\t2026-01-04 00:00:00+00\t1',
      '\\.',
      '',
    ].join('\n')
    expect(parseDumpMigrations(sql)).toEqual(['20260101_init', '20260104_second'])
  })

  it('returns null without a _prisma_migrations table', () => {
    expect(parseDumpMigrations('-- empty\n')).toBeNull()
  })
})

describe('runPgTool', () => {
  it('reports a missing tool as not installed', async () => {
    await expect(runPgTool('famlin-no-such-pg-tool', [], '')).rejects.toBeInstanceOf(PgToolNotInstalledError)
  })

  it('caps captured stdout', async () => {
    const script = "process.stdout.write('x'.repeat(100000))"
    await expect(runPgTool(process.execPath, ['-e', script], '', 1000)).rejects.toThrow(/more than 1000 bytes/)
    await expect(runPgTool(process.execPath, ['-e', script], '', 200000)).resolves.toHaveLength(100000)
  })

  it('rejects with stderr on a non-zero exit', async () => {
    const script = "process.stderr.write('boom'); process.exit(3)"
    await expect(runPgTool(process.execPath, ['-e', script], '')).rejects.toThrow('boom')
  })
})

describe('setup dump restore', () => {
  let app: FastifyInstance
  let local: string[]
  let calls = 0

  beforeAll(async () => {
    app = await buildTestApp()
    local = await readLocalMigrations()
  })

  afterAll(async () => {
    await app.close()
    await fsp.rm(BACKUP_DB_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    await fsp.rm(BACKUP_DB_DIR, { recursive: true, force: true })
    vi.spyOn(restoreDumpDeps, 'readDumpMigrations').mockResolvedValue(local.slice(0, -1))
    vi.spyOn(restoreDumpDeps, 'replaceDatabase').mockResolvedValue()
    vi.spyOn(restoreDumpDeps, 'migrateDeploy').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Rate-limited per IP: give each call its own address.
  function nextAddress() {
    calls += 1
    return `10.1.${Math.floor(calls / 250)}.${calls % 250}`
  }

  function list() {
    return app.inject({ method: 'GET', url: '/api/auth/setup/dumps', remoteAddress: nextAddress() })
  }

  function restore(name: unknown) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/setup/restore-dump',
      remoteAddress: nextAddress(),
      payload: { name },
    })
  }

  describe('GET /api/auth/setup/dumps', () => {
    it('is empty without a backups folder', async () => {
      const res = await list()
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('lists dumps newest first, ignoring partial and unrelated files', async () => {
      await putDump(OLDER)
      await putDump(NEWER, Buffer.concat([DUMP, DUMP]))
      await putDump(`${NEWER}.partial`)
      await putDump('notes.txt')
      await putDump('famlin-manual-copy.dump')
      await fsp.mkdir(path.join(BACKUP_DB_DIR, 'famlin-2026-10-21T03-00-00-000Z.dump'))

      const res = await list()
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([
        { name: NEWER, size: DUMP.length * 2, createdAt: '2026-10-20T03:00:00.000Z' },
        { name: OLDER, size: DUMP.length, createdAt: '2026-10-19T03:00:00.000Z' },
      ])
    })

    it('409s once the instance has users', async () => {
      await putDump(NEWER)
      await createUser()
      const res = await list()
      expect(res.statusCode).toBe(409)
      expect(res.body).not.toContain(NEWER)
    })
  })

  describe('POST /api/auth/setup/restore-dump', () => {
    it('restores the dump, applies pending migrations, ends old sessions and invalidates the settings cache', async () => {
      await putDump(NEWER)
      // The media mirror holds a photo storage lost, and one deleted before the backup.
      const photo = `${randomUUID()}.jpg`
      const gone = `${randomUUID()}.jpg`
      await fsp.rm(BACKUP_UPLOADS_DIR, { recursive: true, force: true })
      await fsp.mkdir(path.join(BACKUP_UPLOADS_DIR, '.deleted', '2026-01-01'), { recursive: true })
      await fsp.writeFile(path.join(BACKUP_UPLOADS_DIR, photo), 'mirrored-photo')
      await fsp.writeFile(path.join(BACKUP_UPLOADS_DIR, '.deleted', '2026-01-01', gone), 'deleted-photo')
      // The "restored" database carries a different setting than the cached one.
      await updateSettings({ defaultLanguage: 'en' })
      expect((await getAllSettings()).defaultLanguage).toBe('en')
      vi.mocked(restoreDumpDeps.replaceDatabase).mockImplementation(async (file) => {
        expect(file).toBe(path.join(BACKUP_DB_DIR, NEWER))
        await prisma.setting.update({ where: { key: 'defaultLanguage' }, data: { value: 'nl' } })
        await createUser({ email: 'restored@example.com' })
      })
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ restored: true, media: { restored: 1, restoredBytes: 14 } })
      expect(await fsp.readFile(path.join(uploadsDir, photo), 'utf8')).toBe('mirrored-photo')
      expect(await fsp.readFile(path.join(BACKUP_UPLOADS_DIR, photo), 'utf8')).toBe('mirrored-photo')
      await expect(fsp.access(path.join(uploadsDir, gone))).rejects.toThrow()
      await fsp.rm(path.join(uploadsDir, photo), { force: true })
      await fsp.rm(BACKUP_UPLOADS_DIR, { recursive: true, force: true })
      expect(restoreDumpDeps.replaceDatabase).toHaveBeenCalledTimes(1)
      expect(restoreDumpDeps.migrateDeploy).toHaveBeenCalledTimes(1)
      const replaceOrder = vi.mocked(restoreDumpDeps.replaceDatabase).mock.invocationCallOrder[0]
      const migrateOrder = vi.mocked(restoreDumpDeps.migrateDeploy).mock.invocationCallOrder[0]
      expect(replaceOrder).toBeLessThan(migrateOrder)
      expect((await getAllSettings()).defaultLanguage).toBe('nl')
      const restored = await prisma.user.findUniqueOrThrow({ where: { email: 'restored@example.com' } })
      expect(restored.tokenVersion).toBe(1)
    })

    it.each([
      '../famlin-2026-10-20T03-00-00-000Z.dump',
      'db/famlin-2026-10-20T03-00-00-000Z.dump',
      '/etc/passwd',
      'famlin-..%2f.dump',
      `${NEWER}.partial`,
      'famlin-manual-copy.dump',
      '',
      42,
    ])('400s for a bad name %j', async (name) => {
      await putDump(NEWER)
      const res = await restore(name)
      expect(res.statusCode).toBe(400)
      expect(restoreDumpDeps.readDumpMigrations).not.toHaveBeenCalled()
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('400s for a well-formed name that is not in the folder', async () => {
      const res = await restore(NEWER)
      expect(res.statusCode).toBe(400)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('409s once the instance has users, without touching the database', async () => {
      await putDump(NEWER)
      await createUser()
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(409)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('re-checks for users under the lock', async () => {
      await putDump(NEWER)
      // An account appears after the route's quick check, before the lock.
      vi.mocked(restoreDumpDeps.readDumpMigrations).mockImplementation(async () => {
        await createUser()
        return local
      })
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(409)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('makes /setup and /setup/restore 409 while it holds the lock', async () => {
      const admin = await createUser({ isAdmin: true })
      const exportRes = await app.inject({ method: 'GET', url: '/api/admin/export', headers: authHeader(admin) })
      expect(exportRes.statusCode).toBe(200)
      await prisma.user.deleteMany()
      await putDump(NEWER)
      let setupStatus = 0
      let zipStatus = 0
      vi.mocked(restoreDumpDeps.replaceDatabase).mockImplementation(async () => {
        const setup = await app.inject({
          method: 'POST',
          url: '/api/auth/setup',
          remoteAddress: nextAddress(),
          payload: { email: 'race@example.com', name: 'Race', password: 'password123' },
        })
        setupStatus = setup.statusCode
        const zip = await app.inject({
          method: 'POST',
          url: '/api/auth/setup/restore',
          remoteAddress: nextAddress(),
          ...zipUpload(exportRes.rawPayload),
        })
        zipStatus = zip.statusCode
      })
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(200)
      expect(setupStatus).toBe(409)
      expect(zipStatus).toBe(409)
      expect(await prisma.user.count()).toBe(0)
    })

    it('400s for a file that is not a pg custom-format dump', async () => {
      await putDump(NEWER, Buffer.from('PK\u0003\u0004 not a dump'))
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(400)
      expect(restoreDumpDeps.readDumpMigrations).not.toHaveBeenCalled()
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('refuses a dump from a newer Famlin version before touching the database', async () => {
      await putDump(NEWER)
      vi.mocked(restoreDumpDeps.readDumpMigrations).mockResolvedValue([...local, '29991231000000_from_the_future'])
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(400)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
      expect(restoreDumpDeps.migrateDeploy).not.toHaveBeenCalled()
    })

    it('400s for a dump without Famlin migrations', async () => {
      await putDump(NEWER)
      vi.mocked(restoreDumpDeps.readDumpMigrations).mockResolvedValue(null)
      const res = await restore(NEWER)
      expect(res.statusCode).toBe(400)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('reports a missing pg_restore as a server problem, not a bad file', async () => {
      await putDump(NEWER)
      vi.mocked(restoreDumpDeps.readDumpMigrations).mockRejectedValue(new PgToolNotInstalledError('pg_restore'))
      const res = await restore(NEWER)
      expect(res.statusCode).toBe(500)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    })

    it('leaves the database untouched when the role cannot recreate the schema', async () => {
      await putDump(NEWER)
      vi.spyOn(restoreDumpDeps, 'assertCanReplaceSchema').mockRejectedValue(new RestoreDumpError('noPrivilege'))
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(500)
      expect(res.json().error).toMatch(/schema/)
      expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
      expect(restoreDumpDeps.migrateDeploy).not.toHaveBeenCalled()
    })

    it('passes the real privilege check on the test database', async () => {
      await expect(restoreDumpDeps.assertCanReplaceSchema()).resolves.toBeUndefined()
    })

    it('500s with a generic message when pg_restore fails, and re-migrates the empty schema', async () => {
      await putDump(NEWER)
      vi.mocked(restoreDumpDeps.replaceDatabase).mockRejectedValue(new Error('pg_restore: secret detail'))
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(500)
      expect(res.body).not.toContain('secret detail')
      expect(restoreDumpDeps.migrateDeploy).toHaveBeenCalledTimes(1)
    })

    it('reports a distinct error when the migrations fail after the restore', async () => {
      await putDump(NEWER)
      vi.mocked(restoreDumpDeps.migrateDeploy).mockRejectedValue(new MigrateDeployError(1))
      const res = await restore(NEWER)

      expect(res.statusCode).toBe(500)
      expect(res.json().error).toMatch(/Restart the server/)
    })
  })
})

// A multipart body for /setup/restore: a real export plus /setup's fields.
function zipUpload(archive: Buffer) {
  const boundary = '----famlinzip'
  const field = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const payload = Buffer.concat([
    Buffer.from(field('email', 'race@example.com') + field('name', 'Race') + field('password', 'password123')),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="a.zip"\r\nContent-Type: application/zip\r\n\r\n`
    ),
    archive,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
