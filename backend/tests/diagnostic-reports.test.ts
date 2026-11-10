import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/db.js'
import { DIAGNOSTIC_REPORT_RETENTION_DAYS, pruneDiagnosticReports } from '../src/services/diagnosticReports.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'

const frames = {
  frames: 1284,
  durationMs: 21400,
  droppedFrames: 31,
  hitchMsPerSecond: 12.3,
  worstFrameMs: 84,
  p95FrameMs: 17.1,
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'feed_scroll',
    platform: 'ios',
    appVersion: '1.2.3',
    text: 'Famlin scroll diagnostics\nDevice: iPhone 13 · iOS 26.1',
    data: {
      device: 'iPhone 13',
      os: 'iOS 26.1',
      app: '1.2.3 (45)',
      server: '0.9.0',
      refreshHz: 60,
      ui: frames,
      js: { ...frames, hitchMsPerSecond: 3.1 },
      content: {
        posts: 34,
        postsWithMedia: 26,
        multiMediaPosts: 12,
        mediaItems: 71,
        videos: 4,
        byType: { UPDATE: 31 },
      },
      imageLoads: { network: 48, disk: 20, memory: 3 },
    },
    ...overrides,
  }
}

describe('diagnostic reports', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('stores a member’s report for the admin to read and delete', async () => {
    const member = await createUser({ name: 'Reporting Member' })
    const admin = await createUser({ isAdmin: true })

    const unauthenticated = await app.inject({ method: 'POST', url: '/api/diagnostics/reports', payload: report() })
    expect(unauthenticated.statusCode).toBe(401)

    const created = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/reports',
      payload: report(),
      headers: authHeader(member),
    })
    expect(created.statusCode).toBe(201)
    const { id } = created.json()

    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/diagnostics', headers: authHeader(member) })
    expect(forbidden.statusCode).toBe(403)

    const list = await app.inject({ method: 'GET', url: '/api/admin/diagnostics', headers: authHeader(admin) })
    expect(list.statusCode).toBe(200)
    const body = list.json()
    expect(body.retentionDays).toBe(DIAGNOSTIC_REPORT_RETENTION_DAYS)
    const item = body.items.find((r: { id: string }) => r.id === id)
    expect(item).toMatchObject({
      kind: 'feed_scroll',
      platform: 'ios',
      appVersion: '1.2.3',
      text: report().text,
      data: report().data,
      user: { id: member.id, name: 'Reporting Member' },
    })

    const memberDelete = await app.inject({
      method: 'DELETE',
      url: `/api/admin/diagnostics/${id}`,
      headers: authHeader(member),
    })
    expect(memberDelete.statusCode).toBe(403)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/admin/diagnostics/${id}`,
      headers: authHeader(admin),
    })
    expect(deleted.statusCode).toBe(200)
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/diagnostics/${id}`,
      headers: authHeader(admin),
    })
    expect(again.statusCode).toBe(404)
  })

  it('rejects unknown kinds and out-of-bounds data', async () => {
    const member = await createUser()
    const send = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/diagnostics/reports',
        payload: payload as object,
        headers: authHeader(member),
      })

    expect((await send(report({ kind: 'something_else' }))).statusCode).toBe(400)
    expect((await send(report({ text: 'x'.repeat(4001) }))).statusCode).toBe(400)
    expect((await send(report({ platform: 'web' }))).statusCode).toBe(400)
    const tooManyTypes = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`T${i}`, 1]))
    const data = report().data
    expect(
      (await send(report({ data: { ...data, content: { ...data.content, byType: tooManyTypes } } }))).statusCode
    ).toBe(400)
    expect((await send(report({ data: { ...data, ui: { ...frames, frames: -1 } } }))).statusCode).toBe(400)
  })

  it('is deleted with the member’s account', async () => {
    const member = await createUser()
    await app.inject({
      method: 'POST',
      url: '/api/diagnostics/reports',
      payload: report(),
      headers: authHeader(member),
    })
    expect(await prisma.diagnosticReport.count({ where: { userId: member.id } })).toBe(1)
    await prisma.user.delete({ where: { id: member.id } })
    expect(await prisma.diagnosticReport.count({ where: { userId: member.id } })).toBe(0)
  })

  it('prunes reports older than the retention window', async () => {
    const member = await createUser()
    const now = new Date()
    const day = 24 * 60 * 60 * 1000
    const base = {
      userId: member.id,
      kind: 'feed_scroll',
      platform: 'android',
      appVersion: '1.2.3',
      text: 'report',
      data: report().data,
    }
    const old = await prisma.diagnosticReport.create({
      data: { ...base, createdAt: new Date(now.getTime() - (DIAGNOSTIC_REPORT_RETENTION_DAYS + 1) * day) },
    })
    const recent = await prisma.diagnosticReport.create({
      data: { ...base, createdAt: new Date(now.getTime() - (DIAGNOSTIC_REPORT_RETENTION_DAYS - 1) * day) },
    })

    expect(await pruneDiagnosticReports(now)).toBeGreaterThanOrEqual(1)
    expect(await prisma.diagnosticReport.findUnique({ where: { id: old.id } })).toBeNull()
    expect(await prisma.diagnosticReport.findUnique({ where: { id: recent.id } })).not.toBeNull()
  })

  it('is in the sender’s own member export, not in anyone else’s', async () => {
    const sender = await createUser()
    const other = await createUser()
    await app.inject({
      method: 'POST',
      url: '/api/diagnostics/reports',
      payload: report({ text: 'sender-only-report-marker' }),
      headers: authHeader(sender),
    })

    const exportOf = async (user: Parameters<typeof authHeader>[0]) => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(user) })
      expect(res.statusCode).toBe(200)
      return res.rawPayload.toString('latin1')
    }
    const senderExport = await exportOf(sender)
    expect(senderExport).toContain('data/diagnostic-reports.json')
    expect(senderExport).toContain('sender-only-report-marker')
    expect(await exportOf(other)).not.toContain('sender-only-report-marker')
  })
})
