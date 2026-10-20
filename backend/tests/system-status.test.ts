import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'
import { updateSettings } from '../src/services/settings.js'
import { backupAlerts, alertDeps, sendAlertEmails, type ActiveAlert } from '../src/services/systemAlerts.js'
import { isLowDisk, nextBackupAt } from '../src/services/systemStatus.js'
import { backupDeps } from '../src/services/backup/index.js'
import { dumpFileName } from '../src/services/backup/dbDump.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

describe('backupAlerts (staleness detection)', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const base = {
    enabled: true,
    schedule: 'daily' as const,
    lastOk: true,
    lastSuccessAt: ago(HOUR_MS),
    enabledSince: null,
  }

  it('reports nothing while backups are off, even after a failure', () => {
    expect(backupAlerts({ ...base, enabled: false, lastOk: false }, now)).toEqual([])
  })

  it('reports a failed last run', () => {
    expect(backupAlerts({ ...base, lastOk: false }, now).map((a) => a.condition)).toEqual(['backup_failed'])
  })

  it('flags a daily backup as stale after more than 2 days', () => {
    expect(backupAlerts({ ...base, lastSuccessAt: ago(47 * HOUR_MS) }, now)).toEqual([])
    expect(backupAlerts({ ...base, lastSuccessAt: ago(49 * HOUR_MS) }, now)).toEqual([
      { condition: 'backup_stale', params: { days: 2 } },
    ])
  })

  it('flags a weekly backup as stale after more than 2 weeks', () => {
    const weekly = { ...base, schedule: 'weekly' as const }
    expect(backupAlerts({ ...weekly, lastSuccessAt: ago(13 * DAY_MS) }, now)).toEqual([])
    expect(backupAlerts({ ...weekly, lastSuccessAt: ago(15 * DAY_MS) }, now)[0].condition).toBe('backup_stale')
  })

  it('measures from when backups were enabled until the first success', () => {
    const neverRan = { ...base, lastOk: null, lastSuccessAt: null }
    expect(backupAlerts({ ...neverRan, enabledSince: ago(HOUR_MS) }, now)).toEqual([])
    expect(backupAlerts({ ...neverRan, enabledSince: ago(3 * DAY_MS) }, now)[0].condition).toBe('backup_stale')
  })
})

describe('isLowDisk', () => {
  const GIB = 1024 ** 3
  it('trips below 1 GiB or below 5% free', () => {
    expect(isLowDisk(0.5 * GIB, 4 * GIB)).toBe(true)
    expect(isLowDisk(40 * GIB, 1000 * GIB)).toBe(true)
    expect(isLowDisk(100 * GIB, 1000 * GIB)).toBe(false)
  })
})

describe('nextBackupAt', () => {
  it('is the next matching hour, and null when disabled', () => {
    const now = new Date(2026, 9, 20, 3, 30) // Tuesday 03:30
    const daily = { backupEnabled: true, backupSchedule: 'daily' as const, backupHour: 3 }
    expect(nextBackupAt(now, daily)).toEqual(new Date(2026, 9, 21, 3, 0))
    expect(nextBackupAt(now, { ...daily, backupSchedule: 'weekly' })).toEqual(new Date(2026, 9, 25, 3, 0))
    expect(nextBackupAt(now, { ...daily, backupEnabled: false })).toBeNull()
  })
})

describe('sendAlertEmails (throttling)', () => {
  const alert: ActiveAlert = { condition: 'backup_failed', params: {} }
  let sendMail: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    await createUser({ isAdmin: true, email: 'admin-alerts@example.com' })
    await createUser({ isAdmin: false, email: 'member-alerts@example.com' })
  })

  beforeEach(async () => {
    await prisma.systemAlert.deleteMany()
    sendMail = vi.fn().mockResolvedValue({})
    vi.spyOn(alertDeps, 'createTransporter').mockResolvedValue({ sendMail, close: vi.fn() } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emails admins only, once per condition per day', async () => {
    const t0 = new Date('2026-10-20T03:00:00Z')

    expect(await sendAlertEmails([alert], t0)).toEqual(['backup_failed'])
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toEqual(['admin-alerts@example.com'])
    expect(sendMail.mock.calls[0][0].text).toContain('The last scheduled backup failed.')

    expect(await sendAlertEmails([alert], new Date(t0.getTime() + 23 * HOUR_MS))).toEqual([])
    expect(sendMail).toHaveBeenCalledTimes(1)

    expect(await sendAlertEmails([alert], new Date(t0.getTime() + 25 * HOUR_MS))).toEqual(['backup_failed'])
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('throttles each condition separately', async () => {
    const t0 = new Date('2026-10-20T03:00:00Z')
    await sendAlertEmails([alert], t0)
    const disk: ActiveAlert = { condition: 'disk_low_uploads', params: { free: '0.4' } }

    expect(await sendAlertEmails([alert, disk], new Date(t0.getTime() + HOUR_MS))).toEqual(['disk_low_uploads'])
    expect(sendMail.mock.calls[1][0].text).toContain('0.4 GiB free')
    expect(sendMail.mock.calls[1][0].text).not.toContain('backup failed')
  })

  it("doesn't use up the day's email without SMTP, or when sending fails", async () => {
    const t0 = new Date('2026-10-20T03:00:00Z')
    vi.mocked(alertDeps.createTransporter).mockResolvedValueOnce(null)
    expect(await sendAlertEmails([alert], t0)).toEqual([])

    sendMail.mockRejectedValueOnce(new Error('SMTP down'))
    await expect(sendAlertEmails([alert], t0)).rejects.toThrow('SMTP down')

    expect(await sendAlertEmails([alert], new Date(t0.getTime() + HOUR_MS))).toEqual(['backup_failed'])
  })
})

describe('admin status routes', () => {
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof createUser>>
  let member: Awaited<ReturnType<typeof createUser>>

  beforeAll(async () => {
    app = await buildTestApp()
    admin = await createUser({ isAdmin: true })
    member = await createUser()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  it('are admin-only', async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/status'],
      ['GET', '/api/admin/status/integrations'],
      ['GET', '/api/admin/status/alerts'],
      ['POST', '/api/admin/backups/run'],
    ] as const) {
      const res = await app.inject({ method, url, headers: authHeader(member) })
      expect(res.statusCode, url).toBe(403)
    }
  })

  it('GET /status reports every signal group', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/status', headers: authHeader(admin) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.backups).toMatchObject({ enabled: false, schedule: 'daily', hour: 3, retention: 7, running: false })
    expect(body.disk.uploads.totalBytes).toBeGreaterThan(0)
    expect(body.jobs.map((j: { job: string }) => j.job)).toEqual([
      'onThisDay',
      'newAssets',
      'expireStories',
      'backup',
      'systemAlerts',
    ])
    expect(body.migrations.pending).toEqual([])
    expect(body.migrations.latestApplied).toMatch(/^\d{14}_/)
    expect(body.push.last24h).toEqual({ attempts: 0, delivered: 0, failed: 0, failureRate: null })
    expect(Array.isArray(body.alerts)).toBe(true)
  })

  it('GET /status/integrations reports unconfigured integrations without probing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/status/integrations', headers: authHeader(admin) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      smtp: { configured: false, ok: null },
      oidc: { configured: false, ok: null },
      immich: { configured: false, ok: null },
      localMedia: { configured: false, ok: null },
    })
  })

  it('POST /backups/run starts a backup in the background and refuses a second one', async () => {
    let release!: () => void
    vi.spyOn(backupDeps, 'dumpDatabase').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ file: dumpFileName(new Date()), bytes: 1 })
        })
    )

    const res = await app.inject({ method: 'POST', url: '/api/admin/backups/run', headers: authHeader(admin) })
    expect(res.statusCode).toBe(202)
    const again = await app.inject({ method: 'POST', url: '/api/admin/backups/run', headers: authHeader(admin) })
    expect(again.statusCode).toBe(409)

    await vi.waitFor(() => expect(release).toBeDefined())
    release()
    await vi.waitFor(async () => {
      const status = await prisma.jobStatus.findUnique({ where: { job: 'backup' } })
      expect(status?.lastOk).toBe(true)
    })
  })

  it('shows a failed backup as an alert once backups are enabled', async () => {
    await prisma.jobStatus.upsert({
      where: { job: 'backup' },
      create: { job: 'backup', lastStartedAt: new Date(), lastOk: false, lastError: 'boom' },
      update: { lastOk: false, lastError: 'boom' },
    })

    const off = await app.inject({ method: 'GET', url: '/api/admin/status/alerts', headers: authHeader(admin) })
    expect(off.json().alerts.map((a: ActiveAlert) => a.condition)).not.toContain('backup_failed')

    await updateSettings({ backupEnabled: true })
    const on = await app.inject({ method: 'GET', url: '/api/admin/status/alerts', headers: authHeader(admin) })
    expect(on.json().alerts.map((a: ActiveAlert) => a.condition)).toContain('backup_failed')
    await updateSettings({ backupEnabled: false })
  })

  it('validates the backup settings', async () => {
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: authHeader(admin),
      payload: { backupHour: 24 },
    })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: authHeader(admin),
      payload: { backupEnabled: true, backupSchedule: 'weekly', backupHour: 2, backupRetention: 14 },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({
      backupEnabled: true,
      backupSchedule: 'weekly',
      backupHour: 2,
      backupRetention: 14,
    })
    await updateSettings({ backupEnabled: false })
  })
})
