import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import fsp from 'fs/promises'
import path from 'path'
import { Decrypter } from 'age-encryption'
import { prisma } from '../src/db.js'
import {
  BACKUP_ARCHIVE_DIR,
  BACKUP_DB_DIR,
  backupDeps,
  endRestore,
  isRestoreRunning,
  runBackup,
} from '../src/services/backup/index.js'
import { dumpFileName } from '../src/services/backup/dbDump.js'
import { backupSidecarFileName } from '../src/services/backup/archive.js'
import { getRestoreStatus } from '../src/services/backup/restoreRunning.js'
import {
  generateBackupKey,
  getBackupEncryptionStatus,
  parseKeyInput,
  setBackupEncryptionEnabled,
} from '../src/services/backup/encryption.js'
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js'

// Issue #495: encrypted backups (age, a generated key + emergency kit).

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

function multipartBody(fields: Record<string, string>, archive: Buffer) {
  const boundary = `----famlin${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="export.zip.age"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ),
    archive,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`)
  )
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

const PG_DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(16, 1)])

describe('encrypted backups', () => {
  let app: FastifyInstance
  let calls = 0
  const address = () => `10.4.${Math.floor(++calls / 250)}.${calls % 250}`

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

  async function kitFor(admin: Parameters<typeof authHeader>[0], key?: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/backups/encryption/kit${key ? `?key=${key}` : ''}`,
      headers: authHeader(admin),
    })
    expect(res.statusCode).toBe(200)
    return res.body
  }

  async function enableEncryption(admin: Parameters<typeof authHeader>[0]) {
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/backups/encryption/key', headers: authHeader(admin) }))
        .statusCode
    ).toBe(200)
    const kit = await kitFor(admin)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/backups/encryption',
      headers: authHeader(admin),
      payload: { enabled: true, kitSaved: true },
    })
    expect(res.statusCode).toBe(200)
    return kit
  }

  it('parses an emergency kit, a bare identity or a passphrase', () => {
    const kit = '# Famlin backup emergency kit\n# age1abc\n\nAGE-SECRET-KEY-1ABCDEF\n'
    expect(parseKeyInput(kit)).toEqual({ identities: ['AGE-SECRET-KEY-1ABCDEF'], passphrase: null })
    expect(parseKeyInput('  correct horse battery staple ')).toEqual({
      identities: [],
      passphrase: 'correct horse battery staple',
    })
    expect(parseKeyInput('')).toEqual({ identities: [], passphrase: null })
  })

  it('gates turning encryption on behind a key and the kit confirmation, signed-in admins only', async () => {
    const admin = await createUser({ isAdmin: true })
    const member = await createUser()
    const put = (payload: unknown, headers = authHeader(admin)) =>
      app.inject({ method: 'PUT', url: '/api/admin/backups/encryption', headers, payload })

    expect((await put({ enabled: true, kitSaved: true })).statusCode).toBe(400) // no key yet
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/backups/encryption/key', headers: authHeader(member) }))
        .statusCode
    ).toBe(403)
    await app.inject({ method: 'POST', url: '/api/admin/backups/encryption/key', headers: authHeader(admin) })
    expect((await put({ enabled: true })).statusCode).toBe(400) // kit not confirmed

    const created = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: authHeader(admin),
      payload: { name: 'script', adminAccess: true },
    })
    const pat = { authorization: `Bearer ${created.json().token}` }
    expect((await put({ enabled: true, kitSaved: true }, pat)).statusCode).toBe(403)
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/backups/encryption/kit', headers: pat })).statusCode
    ).toBe(403)

    const res = await put({ enabled: true, kitSaved: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().encryption).toMatchObject({ enabled: true, currentKey: { id: expect.stringMatching(/^age1/) } })

    // The kit is an age identity file with instructions; the key never shows up elsewhere.
    const kit = await kitFor(admin)
    expect(kit).toMatch(/^# Famlin backup emergency kit/)
    expect(kit).toMatch(/^AGE-SECRET-KEY-1[0-9A-Z]+$/m)
    const list = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(admin) })
    expect(JSON.stringify(list.json())).not.toContain('AGE-SECRET-KEY')
    const settings = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: authHeader(admin) })
    expect(JSON.stringify(settings.json())).not.toContain('AGE-SECRET-KEY')
  })

  it('writes an encrypted backup with a sidecar, no pg_dump, and lists which key it needs', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin)
    await createPost({ groupId: group.id, authorId: admin.id, content: 'a secret family moment' })
    // An unencrypted run first: its plaintext dump must not outlive encryption.
    await fsp.rm(BACKUP_DB_DIR, { recursive: true, force: true })
    await runBackup('manual', new Date('2026-11-01T03:00:00Z'))
    expect(await fsp.readdir(BACKUP_DB_DIR)).toHaveLength(1)
    vi.mocked(backupDeps.dumpDatabase).mockClear()
    const kit = await enableEncryption(admin)

    const result = await runBackup('manual')
    expect(result.archiveFile).toMatch(/\.zip\.age$/)
    expect(result.archiveEncrypted).toBe(true)
    expect(result.dumpFile).toBeNull()
    expect(backupDeps.dumpDatabase).not.toHaveBeenCalled()
    expect(await fsp.readdir(BACKUP_DB_DIR)).toEqual([])

    const bytes = await fsp.readFile(path.join(BACKUP_ARCHIVE_DIR, result.archiveFile))
    expect(bytes.subarray(0, 21).toString()).toBe('age-encryption.org/v1')
    expect(bytes.includes(Buffer.from('a secret family moment'))).toBe(false)
    // The kit opens it with plain age.
    const decrypter = new Decrypter()
    decrypter.addIdentity(parseKeyInput(kit).identities[0])
    const zip = Buffer.from(await decrypter.decrypt(bytes))
    expect(zip.subarray(0, 2).toString()).toBe('PK')

    const sidecar = JSON.parse(
      await fsp.readFile(path.join(BACKUP_ARCHIVE_DIR, backupSidecarFileName(result.archiveFile)), 'utf8')
    )
    const { currentKey } = await getBackupEncryptionStatus()
    expect(sidecar).toMatchObject({ encrypted: true, keyId: currentKey!.id, trigger: 'manual' })

    const list = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(admin) })
    expect(list.json().backups.find((b: { name: string }) => b.name === result.archiveFile)).toMatchObject({
      encrypted: true,
      keyId: currentKey!.id,
      keyAvailable: true,
      valid: true,
    })

    // Deleting removes the sidecar too (the earlier plaintext backup stays).
    await app.inject({ method: 'DELETE', url: `/api/admin/backups/${result.archiveFile}`, headers: authHeader(admin) })
    expect((await fsp.readdir(BACKUP_ARCHIVE_DIR)).filter((n) => n.startsWith('famlin-backup-')).sort()).toEqual([
      'famlin-backup-2026-11-01T03-00-00-000Z.meta.json',
      'famlin-backup-2026-11-01T03-00-00-000Z.zip',
    ])
  })

  it('keeps using the current key while a new one is pending', async () => {
    const admin = await createUser({ isAdmin: true })
    await enableEncryption(admin)
    const current = (await getBackupEncryptionStatus()).currentKey!
    await generateBackupKey()
    const result = await runBackup('manual')
    const sidecar = JSON.parse(
      await fsp.readFile(path.join(BACKUP_ARCHIVE_DIR, backupSidecarFileName(result.archiveFile)), 'utf8')
    )
    expect(sidecar.keyId).toBe(current.id)
  })

  it('fails the backup instead of writing plaintext when encryption is on without a key', async () => {
    await prisma.setting.create({ data: { key: 'backupEncryptionEnabled', value: 'true' } })
    await expect(runBackup('manual')).rejects.toThrow()
    expect(
      (await fsp.readdir(BACKUP_ARCHIVE_DIR).catch(() => [] as string[])).filter((n) => n.startsWith('famlin-backup-'))
    ).toEqual([])
  })

  it('keeps old keys after rotation, and restores onto the running server with the stored key', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin)
    const kept = await createPost({ groupId: group.id, authorId: admin.id })
    await enableEncryption(admin)
    const { archiveFile } = await runBackup('manual', new Date('2026-11-01T03:00:00Z'))
    const later = await createPost({ groupId: group.id, authorId: admin.id })

    const before = (await getBackupEncryptionStatus()).currentKey!
    await app.inject({ method: 'POST', url: '/api/admin/backups/encryption/key', headers: authHeader(admin) })
    // The new key stays pending — backups keep using the old one — until its kit is confirmed.
    const pending = await getBackupEncryptionStatus()
    expect(pending.currentKey).toEqual(before)
    expect(pending.pendingKey!.id).not.toBe(before.id)
    expect(await kitFor(admin)).toContain(pending.pendingKey!.id)
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backups/encryption',
      headers: authHeader(admin),
      payload: { enabled: true, kitSaved: true },
    })
    const after = await getBackupEncryptionStatus()
    expect(after.currentKey!.id).toBe(pending.pendingKey!.id)
    expect(after.pendingKey).toBeNull()
    expect(after.keys.map((k) => k.id)).toEqual([after.currentKey!.id, before.id])

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/backups/${archiveFile}/restore`,
      headers: authHeader(admin),
      payload: { confirm: 'Famlin' },
      remoteAddress: address(),
    })
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(getRestoreStatus().running).toBe(false), { timeout: 10_000 })
    expect(getRestoreStatus()).toMatchObject({ ok: true, error: null })
    // The safety backup was encrypted with the new key.
    expect(getRestoreStatus().safetyBackup).toMatch(/\.zip\.age$/)
    expect(await prisma.post.findUnique({ where: { id: kept.id } })).not.toBeNull()
    expect(await prisma.post.findUnique({ where: { id: later.id } })).toBeNull()
    // The keys survive the restore, encryption stays on.
    expect(await getBackupEncryptionStatus()).toMatchObject({ enabled: true, currentKey: after.currentKey })
  })

  it('asks for the emergency kit when this server lacks the key, and keeps it afterwards', async () => {
    const admin = await createUser({ isAdmin: true })
    const kit = await enableEncryption(admin)
    const { archiveFile } = await runBackup('manual')
    // As if the key were lost on this server (the kit is all that's left).
    await prisma.setting.deleteMany({ where: { key: 'backupEncryptionKeys' } })
    await generateBackupKey()
    await setBackupEncryptionEnabled(true)

    const restore = (key?: string) =>
      app.inject({
        method: 'POST',
        url: `/api/admin/backups/${archiveFile}/restore`,
        headers: authHeader(admin),
        payload: { confirm: 'Famlin', ...(key ? { key } : {}) },
        remoteAddress: address(),
      })
    const list = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: authHeader(admin) })
    expect(list.json().backups.find((b: { name: string }) => b.name === archiveFile)).toMatchObject({
      keyAvailable: false,
    })

    const missing = await restore()
    expect(missing.statusCode).toBe(400)
    expect(missing.json().code).toBe('backupKeyRequired')
    const wrong = await restore('AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ')
    expect(wrong.json().code).toBe('backupKeyMismatch')
    expect(isRestoreRunning()).toBe(false)

    expect((await restore(kit)).statusCode).toBe(202)
    await vi.waitFor(() => expect(getRestoreStatus().running).toBe(false), { timeout: 10_000 })
    expect(getRestoreStatus()).toMatchObject({ ok: true })
    const { keys } = await getBackupEncryptionStatus()
    expect(keys).toHaveLength(2)
  })

  it('restores an encrypted backup on a fresh server with the kit, and keeps encrypting with it', async () => {
    const admin = await createUser({ isAdmin: true, email: 'admin@example.com', password: 'admin-password-1' })
    const group = await createGroupWithMember(admin)
    const post = await createPost({ groupId: group.id, authorId: admin.id })
    const kit = await enableEncryption(admin)
    const keyId = (await getBackupEncryptionStatus()).currentKey!.id
    const { archiveFile } = await runBackup('manual')

    // A new server: everything gone, the backups volume kept.
    await truncateAll()

    const setupList = await app.inject({ method: 'GET', url: '/api/auth/setup/backups', remoteAddress: address() })
    expect(setupList.json().find((b: { name: string }) => b.name === archiveFile)).toMatchObject({
      encrypted: true,
      keyId,
      keyAvailable: false,
    })
    const restore = (payload: unknown) =>
      app.inject({ method: 'POST', url: '/api/auth/setup/restore-backup', payload, remoteAddress: address() })
    const missing = await restore({ file: archiveFile })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().code).toBe('backupKeyRequired')
    expect(await prisma.user.count()).toBe(0)

    const res = await restore({ file: archiveFile, key: kit })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ restored: true })
    expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull()
    expect(await getBackupEncryptionStatus()).toMatchObject({ enabled: true, currentKey: { id: keyId } })
    expect((await runBackup('manual')).archiveFile).toMatch(/\.zip\.age$/)
  })

  it('encrypts the admin export with a passphrase, and restores it from the setup screen', async () => {
    const admin = await createUser({ isAdmin: true, email: 'admin@example.com', password: 'admin-password-1' })
    const group = await createGroupWithMember(admin)
    const post = await createPost({ groupId: group.id, authorId: admin.id, content: 'exported moment' })

    const short = await app.inject({
      method: 'POST',
      url: '/api/admin/export/token',
      headers: authHeader(admin),
      payload: { passphrase: 'short' },
    })
    expect(short.statusCode).toBe(400)
    const passphrase = 'correct horse battery staple'
    // Surrounding spaces are trimmed, as the restore forms trim them.
    const { token } = (
      await app.inject({
        method: 'POST',
        url: '/api/admin/export/token',
        headers: authHeader(admin),
        payload: { passphrase: ` ${passphrase} ` },
      })
    ).json()
    const download = await app.inject({ method: 'GET', url: `/api/admin/export?downloadToken=${token}` })
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-disposition']).toMatch(/\.zip\.age"$/)
    expect(download.rawPayload.subarray(0, 21).toString()).toBe('age-encryption.org/v1')
    expect(download.rawPayload.includes(Buffer.from('exported moment'))).toBe(false)

    // Without a passphrase the export stays a plain zip.
    const plainToken = (
      await app.inject({ method: 'POST', url: '/api/admin/export/token', headers: authHeader(admin) })
    ).json().token
    const plain = await app.inject({ method: 'GET', url: `/api/admin/export?downloadToken=${plainToken}` })
    expect(plain.rawPayload.subarray(0, 2).toString()).toBe('PK')

    await truncateAll()
    const upload = (fields: Record<string, string>) => {
      const body = multipartBody(fields, download.rawPayload)
      return app.inject({ method: 'POST', url: '/api/auth/setup/restore', remoteAddress: address(), ...body })
    }
    const missing = await upload({})
    expect(missing.json().code).toBe('backupKeyRequired')
    expect((await upload({ key: 'not the passphrase' })).json().code).toBe('backupKeyMismatch')
    const res = await upload({ key: passphrase })
    expect(res.statusCode).toBe(200)
    expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull()
    // A passphrase isn't a backup key: nothing to adopt.
    expect((await getBackupEncryptionStatus()).enabled).toBe(false)
  })

  it('turns encryption off again; later backups are plain zips', async () => {
    const admin = await createUser({ isAdmin: true })
    await enableEncryption(admin)
    await setBackupEncryptionEnabled(false)
    const result = await runBackup('manual')
    expect(result.archiveFile).toMatch(/\.zip$/)
    expect(result.dumpFile).not.toBeNull()
  })
})
