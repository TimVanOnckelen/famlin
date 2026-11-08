import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../src/db.js'
import { parseDumpMigrations, restoreDumpDeps } from '../src/services/backup/restoreDump.js'
import { readLocalMigrations } from '../src/services/migrationGuard.js'
import { getAllSettings, updateSettings } from '../src/services/settings.js'
import { buildTestApp, createUser } from './helpers.js'

// pg_restore and `prisma migrate deploy` are stubbed through restoreDumpDeps:
// a real restore would replace the shared test database.

const DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(64, 1)])

function multipart(file: Buffer | null, field = 'dump') {
  const boundary = `----famlin${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="famlin.dump"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      file,
      Buffer.from('\r\n')
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
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

describe('POST /api/auth/setup/restore-dump', () => {
  let app: FastifyInstance
  let local: string[]
  let calls = 0

  beforeAll(async () => {
    app = await buildTestApp()
    local = await readLocalMigrations()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    vi.spyOn(restoreDumpDeps, 'readDumpMigrations').mockResolvedValue(local.slice(0, -1))
    vi.spyOn(restoreDumpDeps, 'replaceDatabase').mockResolvedValue()
    vi.spyOn(restoreDumpDeps, 'migrateDeploy').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Rate-limited per IP: give each call its own address.
  function upload(file: Buffer | null, field?: string) {
    calls += 1
    return app.inject({
      method: 'POST',
      url: '/api/auth/setup/restore-dump',
      remoteAddress: `10.1.0.${calls}`,
      ...multipart(file, field),
    })
  }

  it('restores the dump, applies pending migrations and invalidates the settings cache', async () => {
    // The "restored" database carries a different setting than the cached one.
    await updateSettings({ defaultLanguage: 'en' })
    expect((await getAllSettings()).defaultLanguage).toBe('en')
    vi.mocked(restoreDumpDeps.replaceDatabase).mockImplementation(async () => {
      await prisma.setting.update({ where: { key: 'defaultLanguage' }, data: { value: 'nl' } })
    })
    const res = await upload(DUMP)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ restored: true })
    expect(res.json()).not.toHaveProperty('token')
    expect(restoreDumpDeps.replaceDatabase).toHaveBeenCalledTimes(1)
    expect(restoreDumpDeps.migrateDeploy).toHaveBeenCalledTimes(1)
    const replaceOrder = vi.mocked(restoreDumpDeps.replaceDatabase).mock.invocationCallOrder[0]
    const migrateOrder = vi.mocked(restoreDumpDeps.migrateDeploy).mock.invocationCallOrder[0]
    expect(replaceOrder).toBeLessThan(migrateOrder)
    expect((await getAllSettings()).defaultLanguage).toBe('nl')
  })

  it('409s once the instance has users, without touching the database', async () => {
    await createUser()
    const res = await upload(DUMP)

    expect(res.statusCode).toBe(409)
    expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
  })

  it('400s for a file that is not a pg custom-format dump', async () => {
    const res = await upload(Buffer.from('PK\u0003\u0004 not a dump'))

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBeTruthy()
    expect(restoreDumpDeps.readDumpMigrations).not.toHaveBeenCalled()
    expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
  })

  it('400s when no dump file was sent', async () => {
    const res = await upload(DUMP, 'archive')
    expect(res.statusCode).toBe(400)
  })

  it('refuses a dump from a newer Famlin version before touching the database', async () => {
    vi.mocked(restoreDumpDeps.readDumpMigrations).mockResolvedValue([...local, '29991231000000_from_the_future'])
    const res = await upload(DUMP)

    expect(res.statusCode).toBe(400)
    expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
    expect(restoreDumpDeps.migrateDeploy).not.toHaveBeenCalled()
  })

  it('400s for a dump without Famlin migrations', async () => {
    vi.mocked(restoreDumpDeps.readDumpMigrations).mockResolvedValue(null)
    const res = await upload(DUMP)
    expect(res.statusCode).toBe(400)
    expect(restoreDumpDeps.replaceDatabase).not.toHaveBeenCalled()
  })

  it('500s with a generic message when pg_restore fails, and re-migrates the empty schema', async () => {
    vi.mocked(restoreDumpDeps.replaceDatabase).mockRejectedValue(new Error('pg_restore: secret detail'))
    const res = await upload(DUMP)

    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('secret detail')
    expect(restoreDumpDeps.migrateDeploy).toHaveBeenCalledTimes(1)
  })
})
