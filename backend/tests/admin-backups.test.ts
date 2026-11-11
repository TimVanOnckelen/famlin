import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import fsp from 'fs/promises'
import path from 'path'
import { prisma } from '../src/db.js'
import { uploadsDir } from '../src/config.js'
import {
  BACKUP_ARCHIVE_DIR,
  backupDeps,
  beginRestore,
  endRestore,
  isRestoreRunning,
  runBackup,
} from '../src/services/backup/index.js'
import { dumpFileName } from '../src/services/backup/dbDump.js'
import { getRestoreStatus } from '../src/services/backup/restoreRunning.js'
import { updateSettings } from '../src/services/settings.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, createPost, authHeader } from './helpers.js'

// Issue #461, PR 2: the admin Backups page restoring onto a running server.

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

async function archives() {
  return (await fsp.readdir(BACKUP_ARCHIVE_DIR)).filter((n) => n.endsWith('.zip')).sort()
}

const PG_DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(16, 1)])

describe('admin Backups page', () => {
  let app: FastifyInstance
  let calls = 0
  const address = () => `10.3.${Math.floor(++calls / 250)}.${calls % 250}`

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
    vi.spyOn(backupDeps, 'dumpDatabase').mockImplementation(async (dir, now) => {
      await fsp.mkdir(dir, { recursive: true })
      const file = dumpFileName(now)
      await fsp.writeFile(path.join(dir, file), PG_DUMP)
      return { file, bytes: PG_DUMP.length }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (isRestoreRunning()) endRestore()
  })

  async function restore(
    admin: { id: string; email: string; name: string; isAdmin: boolean },
    file: string,
    confirm = 'Famlin'
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/admin/backups/${file}/restore`,
      headers: authHeader(admin),
      payload: { confirm },
      remoteAddress: address(),
    })
  }

  it('lists backups for admins only, with the name to type', async () => {
    const admin = await createUser({ isAdmin: true })
    const member = await createUser()
    const { archiveFile } = await runBackup('manual')

    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(member) })).statusCode
    ).toBe(403)
    const res = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(admin) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      backupRunning: false,
      confirmName: 'Famlin',
      restore: { running: false },
      backups: expect.arrayContaining([expect.objectContaining({ name: archiveFile, type: 'archive', safety: false })]),
    })
  })

  it('downloads a backup with a one-time token, and deletes it', async () => {
    const admin = await createUser({ isAdmin: true })
    const { archiveFile } = await runBackup('manual')
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/admin/export/token', headers: authHeader(admin) })
    ).json()

    const download = await app.inject({
      method: 'GET',
      url: `/api/admin/backups/${archiveFile}/download?downloadToken=${token}`,
    })
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-disposition']).toContain(archiveFile)
    expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK')
    const again = await app.inject({
      method: 'GET',
      url: `/api/admin/backups/${archiveFile}/download?downloadToken=${token}`,
    })
    expect(again.statusCode).toBe(401)

    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'famlin-backup-nope.zip']) {
      const res = await app.inject({ method: 'DELETE', url: `/api/admin/backups/${bad}`, headers: authHeader(admin) })
      expect(res.statusCode).toBe(404)
    }
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/backups/${archiveFile}`,
      headers: authHeader(admin),
    })
    expect(del.statusCode).toBe(204)
    expect(await archives()).toEqual([])
  })

  it('restores onto a running server: safety backup first, everything replaced, every session ended', async () => {
    const admin = await createUser({ isAdmin: true, email: 'admin@example.com', password: 'admin-password-1' })
    const member = await createUser({ email: 'member@example.com', password: 'member-password-1' })
    const group = await createGroupWithMember(admin)
    await addMember(group.id, member.id)
    const photo = `${crypto.randomUUID()}.jpg`
    await fsp.writeFile(path.join(uploadsDir, photo), 'family-photo')
    const kept = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [`/uploads/${photo}`] })
    await updateSettings({ defaultLanguage: 'nl', smtpHost: 'smtp.example.com', smtpPass: 'smtp-secret' })
    const { archiveFile } = await runBackup('manual', new Date('2026-11-01T03:00:00Z'))

    // --- life goes on after the backup ---------------------------------
    const later = await createPost({ groupId: group.id, authorId: admin.id, content: 'after the backup' })
    const newcomer = await createUser({ email: 'newcomer@example.com' })
    await prisma.user.update({ where: { id: member.id }, data: { tokenVersion: 7 } })
    await updateSettings({ defaultLanguage: 'fr' })
    await fsp.rm(path.join(uploadsDir, photo))

    // Wrong confirmation and API tokens are refused.
    expect((await restore(admin, archiveFile, 'nope')).statusCode).toBe(400)

    const res = await restore(admin, archiveFile, ' famlin ')
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(getRestoreStatus().running).toBe(false), { timeout: 10_000 })
    const status = getRestoreStatus()
    expect(status).toMatchObject({ ok: true, error: null, file: archiveFile })

    // A safety backup of the state before the restore was kept next to it.
    expect(status.safetyBackup).toBeTruthy()
    expect(await archives()).toContain(status.safetyBackup)
    const restoredAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    const list = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(restoredAdmin) })
    expect(list.json().backups.find((b: { name: string }) => b.name === status.safetyBackup)).toMatchObject({
      safety: true,
    })

    // Everything is as it was in the backup.
    expect(await prisma.post.findUnique({ where: { id: kept.id } })).not.toBeNull()
    expect(await prisma.post.findUnique({ where: { id: later.id } })).toBeNull()
    expect(await prisma.user.findUnique({ where: { id: newcomer.id } })).toBeNull()
    expect(await fsp.readFile(path.join(uploadsDir, photo), 'utf8')).toBe('family-photo')
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'defaultLanguage' } })).value).toBe('nl')
    // This server's own credential survives (same destination).
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'smtpPass' } })).value).toBe('smtp-secret')

    // Every session ended, the admin's own included; passwords are the backup's.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(admin) })).statusCode).toBe(401)
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader({ ...member, tokenVersion: 7 }) }))
        .statusCode
    ).toBe(401)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'member@example.com', password: 'member-password-1' },
    })
    expect(login.statusCode).toBe(200)
    await fsp.rm(path.join(uploadsDir, photo), { force: true })
  })

  it('drops a kept credential whose destination the restore changed', async () => {
    const admin = await createUser({ isAdmin: true })
    await updateSettings({ smtpHost: 'old.example.com' })
    const { archiveFile } = await runBackup('manual')
    await updateSettings({ smtpHost: 'new.example.com', smtpPass: 'secret-for-new-host' })

    expect((await restore(admin, archiveFile)).statusCode).toBe(202)
    await vi.waitFor(() => expect(getRestoreStatus().running).toBe(false), { timeout: 10_000 })
    expect(getRestoreStatus().ok).toBe(true)
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'smtpHost' } })).value).toBe('old.example.com')
    expect(await prisma.setting.findUnique({ where: { key: 'smtpPass' } })).toBeNull()
  })

  it('restores nothing when the safety backup fails', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin)
    const { archiveFile } = await runBackup('manual')
    const later = await createPost({ groupId: group.id, authorId: admin.id })
    vi.spyOn(backupDeps, 'writeBackupArchive').mockRejectedValue(new Error('disk full'))

    expect((await restore(admin, archiveFile)).statusCode).toBe(202)
    await vi.waitFor(() => expect(getRestoreStatus().running).toBe(false), { timeout: 10_000 })
    expect(getRestoreStatus()).toMatchObject({ ok: false, error: 'safetyBackupFailed' })
    expect(await prisma.post.findUnique({ where: { id: later.id } })).not.toBeNull()
  })

  it('answers 503 to the API while a restore runs, but still reports its progress', async () => {
    const admin = await createUser({ isAdmin: true })
    expect(beginRestore()).toBe(true)
    const blocked = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(admin) })
    expect(blocked.statusCode).toBe(503)
    expect(blocked.json().code).toBe('RESTORE_IN_PROGRESS')
    expect((await app.inject({ method: 'GET', url: '/api/auth/restore-status' })).statusCode).toBe(200)
    // No backup may start meanwhile.
    await expect(runBackup('manual')).rejects.toThrow()
    endRestore()
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(admin) })).statusCode).toBe(200)
  })

  it('refuses restore and delete to API tokens and non-admins', async () => {
    const admin = await createUser({ isAdmin: true })
    const member = await createUser()
    const { archiveFile } = await runBackup('manual')
    const created = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: authHeader(admin),
      payload: { name: 'script', adminAccess: true },
    })
    const pat = { authorization: `Bearer ${created.json().token}` }

    for (const headers of [pat, authHeader(member)]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/backups/${archiveFile}/restore`,
        headers,
        payload: { confirm: 'Famlin' },
        remoteAddress: address(),
      })
      expect(res.statusCode).toBe(403)
      const del = await app.inject({ method: 'DELETE', url: `/api/admin/backups/${archiveFile}`, headers })
      expect(del.statusCode).toBe(403)
    }
    expect(await archives()).toContain(archiveFile)
  })
})
