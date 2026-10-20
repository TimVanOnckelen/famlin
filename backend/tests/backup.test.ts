import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { prisma } from '../src/db.js'
import { dumpFileName, pgDumpConnection, pruneDbDumps } from '../src/services/backup/dbDump.js'
import { DELETED_DIR, dayStamp, mirrorUploads } from '../src/services/backup/mirror.js'
import {
  BACKUP_DB_DIR,
  BackupInProgressError,
  backupDeps,
  isBackupDue,
  runBackup,
  runScheduledBackupIfDue,
} from '../src/services/backup/index.js'
import { sanitizeJobError } from '../src/services/jobRuns.js'
import { updateSettings } from '../src/services/settings.js'

const DAY_MS = 24 * 60 * 60 * 1000

let tmp: string
beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-backup-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(tmp, { recursive: true, force: true })
})
afterAll(async () => {
  await prisma.$disconnect()
})

async function write(file: string, content = 'x') {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content)
}

async function exists(file: string) {
  return fsp.access(file).then(
    () => true,
    () => false
  )
}

describe('pruneDbDumps', () => {
  it('keeps the N newest dumps and removes leftover partial files', async () => {
    const names = [0, 1, 2, 3, 4].map((d) => dumpFileName(new Date(Date.UTC(2026, 0, 1 + d, 3))))
    for (const name of names) await write(path.join(tmp, name))
    await write(path.join(tmp, `${dumpFileName(new Date())}.partial`))
    await write(path.join(tmp, 'notes.txt'))

    const deleted = await pruneDbDumps(tmp, 3)

    expect((await fsp.readdir(tmp)).sort()).toEqual([...names.slice(2), 'notes.txt'].sort())
    expect(deleted).toHaveLength(3)
  })

  it('treats an absent dumps directory as empty', async () => {
    expect(await pruneDbDumps(path.join(tmp, 'missing'), 3)).toEqual([])
  })
})

describe('mirrorUploads', () => {
  it('copies only new files and skips the derived cache', async () => {
    const src = path.join(tmp, 'uploads')
    const dest = path.join(tmp, 'mirror')
    await write(path.join(src, 'a.jpg'), 'aaa')
    await write(path.join(src, 'originals', 'a.heic'), 'orig')
    await write(path.join(src, 'derived', 'a.jpg'), 'cache')

    const first = await mirrorUploads(src, dest, new Date())
    expect(first).toMatchObject({ fileCount: 2, copied: 2, totalBytes: 7, movedToDeleted: 0 })
    expect(await fsp.readFile(path.join(dest, 'originals', 'a.heic'), 'utf8')).toBe('orig')
    expect(await exists(path.join(dest, 'derived'))).toBe(false)

    await write(path.join(src, 'b.jpg'), 'bb')
    const second = await mirrorUploads(src, dest, new Date())
    expect(second).toMatchObject({ fileCount: 3, copied: 1, copiedBytes: 2 })
  })

  it('moves vanished files to .deleted/<date> and prunes them after 30 days', async () => {
    const src = path.join(tmp, 'uploads')
    const dest = path.join(tmp, 'mirror')
    const day0 = new Date(Date.UTC(2026, 5, 1, 3))
    await write(path.join(src, 'keep.jpg'))
    await write(path.join(src, 'sub', 'gone.jpg'), 'bye')
    await mirrorUploads(src, dest, day0)

    await fsp.rm(path.join(src, 'sub', 'gone.jpg'))
    const result = await mirrorUploads(src, dest, day0)
    expect(result.movedToDeleted).toBe(1)
    const parked = path.join(dest, DELETED_DIR, dayStamp(day0), 'sub', 'gone.jpg')
    expect(await fsp.readFile(parked, 'utf8')).toBe('bye')
    expect(await exists(path.join(dest, 'sub', 'gone.jpg'))).toBe(false)

    // A parked file isn't itself treated as a vanished upload on later runs.
    expect((await mirrorUploads(src, dest, new Date(day0.getTime() + DAY_MS))).movedToDeleted).toBe(0)

    // Still there 30 days later (a full 30 days, even though the folder is
    // named after a date that began three hours before the delete)...
    await mirrorUploads(src, dest, new Date(day0.getTime() + 30 * DAY_MS))
    expect(await exists(parked)).toBe(true)

    // ...gone a day later.
    const late = await mirrorUploads(src, dest, new Date(day0.getTime() + 31 * DAY_MS))
    expect(late.prunedDeletedDays).toBe(1)
    expect(await exists(parked)).toBe(false)
    expect(await exists(path.join(dest, 'keep.jpg'))).toBe(true)
  })

  it('re-copies a file whose mirrored size differs (an interrupted copy)', async () => {
    const src = path.join(tmp, 'uploads')
    const dest = path.join(tmp, 'mirror')
    await write(path.join(src, 'a.jpg'), 'complete')
    await write(path.join(dest, 'a.jpg'), 'comp')
    await write(path.join(dest, 'b.jpg.famlin-tmp'), 'half')

    const result = await mirrorUploads(src, dest, new Date())
    expect(result.copied).toBe(1)
    expect(await fsp.readFile(path.join(dest, 'a.jpg'), 'utf8')).toBe('complete')
    expect(await exists(path.join(dest, 'b.jpg.famlin-tmp'))).toBe(false)
    expect(result.movedToDeleted).toBe(0)
  })
})

describe('isBackupDue', () => {
  const daily = { backupEnabled: true, backupSchedule: 'daily' as const, backupHour: 3 }
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0)

  it('runs at the configured hour only while enabled', () => {
    expect(isBackupDue(at(2026, 9, 20, 3), daily, null)).toBe(true)
    expect(isBackupDue(at(2026, 9, 20, 4), daily, null)).toBe(false)
    expect(isBackupDue(at(2026, 9, 20, 3), { ...daily, backupEnabled: false }, null)).toBe(false)
  })

  it('runs weekly backups on Sundays only', () => {
    const weekly = { ...daily, backupSchedule: 'weekly' as const }
    expect(isBackupDue(at(2026, 9, 18, 3), weekly, null)).toBe(true) // a Sunday
    expect(isBackupDue(at(2026, 9, 20, 3), weekly, null)).toBe(false) // a Tuesday
  })

  it('skips when a backup already started within the hour', () => {
    const now = at(2026, 9, 20, 3)
    expect(isBackupDue(now, daily, new Date(now.getTime() - 10 * 60 * 1000))).toBe(false)
    expect(isBackupDue(now, daily, new Date(now.getTime() - DAY_MS))).toBe(true)
  })
})

describe('pgDumpConnection', () => {
  it("moves the password out of the URI and Prisma's schema param into --schema", () => {
    expect(pgDumpConnection('postgresql://famlin:s%40cret@db:5432/famlin?schema=public&sslmode=require')).toEqual({
      uri: 'postgresql://famlin@db:5432/famlin?sslmode=require',
      password: 's@cret',
      schema: 'public',
    })
  })
})

describe('sanitizeJobError', () => {
  it('redacts the database password', () => {
    const password = new URL(process.env.DATABASE_URL!).password
    expect(sanitizeJobError(new Error(`could not connect with ${password}`))).not.toContain(password)
  })
})

describe('runBackup', () => {
  it('dumps, prunes to the retention and mirrors, recording the run', async () => {
    await updateSettings({ backupRetention: 2 })
    await fsp.rm(BACKUP_DB_DIR, { recursive: true, force: true })
    let n = 0
    vi.spyOn(backupDeps, 'dumpDatabase').mockImplementation(async (dir) => {
      const file = dumpFileName(new Date(Date.UTC(2026, 0, 1 + n++)))
      await write(path.join(dir, file), 'dump')
      return { file, bytes: 4 }
    })

    for (let i = 0; i < 3; i++) await runBackup('manual')

    expect(await fsp.readdir(BACKUP_DB_DIR)).toHaveLength(2)
    const status = await prisma.jobStatus.findUniqueOrThrow({ where: { job: 'backup' } })
    expect(status.lastOk).toBe(true)
    expect(status.lastSuccessAt).not.toBeNull()
    expect(status.lastDetails).toMatchObject({ trigger: 'manual', dumpBytes: 4, prunedDumps: 1 })
  })

  it('allows only one backup at a time', async () => {
    let release!: () => void
    vi.spyOn(backupDeps, 'dumpDatabase').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ file: dumpFileName(new Date()), bytes: 0 })
        })
    )

    const first = runBackup('manual')
    await expect(runBackup('manual')).rejects.toBeInstanceOf(BackupInProgressError)
    await vi.waitFor(() => expect(release).toBeDefined())
    release()
    await first
  })

  it('records a failed run with its error', async () => {
    vi.spyOn(backupDeps, 'dumpDatabase').mockRejectedValue(new Error('pg_dump: server version mismatch'))

    await expect(runBackup('scheduled')).rejects.toThrow('mismatch')

    const status = await prisma.jobStatus.findUniqueOrThrow({ where: { job: 'backup' } })
    expect(status.lastOk).toBe(false)
    expect(status.lastError).toBe('pg_dump: server version mismatch')
    expect(status.lastFailureAt).not.toBeNull()
  })

  it('runScheduledBackupIfDue does nothing while backups are off', async () => {
    await updateSettings({ backupEnabled: false })
    const dump = vi.spyOn(backupDeps, 'dumpDatabase')
    expect(await runScheduledBackupIfDue()).toBeNull()
    expect(dump).not.toHaveBeenCalled()
  })
})
