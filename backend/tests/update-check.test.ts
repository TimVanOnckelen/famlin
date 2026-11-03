import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '../src/db.js'
import pkg from '../package.json' with { type: 'json' }
import { compareVersions, getUpdateNotice, runUpdateCheck } from '../src/services/updateCheck.js'
import { updateSettings } from '../src/services/settings.js'
import { buildTestApp, createUser, authHeader } from './helpers.js'

afterAll(async () => {
  await prisma.$disconnect()
})

function mockRelease(tag: string, body = 'notes') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ tag_name: tag, html_url: 'https://github.com/x/y/releases/tag/' + tag, body }), {
      status: 200,
    })
  )
}

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1)
  })
  it('ranks prereleases below the release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1)
  })
  it('returns null for garbage', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull()
  })
})

describe('update check service', () => {
  beforeEach(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: ['updateCheckResult', 'updateCheckEnabled'] } } })
    await updateSettings({ updateCheckEnabled: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('flags a newer release and stores it', async () => {
    const fetchSpy = mockRelease('v99.0.0', '## BREAKING CHANGES\n* x')
    const run = await runUpdateCheck()
    expect(run).toEqual({ checked: true, updateAvailable: true })
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'User-Agent': 'famlin-server' })
    const notice = await getUpdateNotice()
    expect(notice).toMatchObject({ latest: '99.0.0', current: pkg.version, breaking: true, updateAvailable: true })
  })

  it('does not flag the same version', async () => {
    mockRelease(`v${pkg.version}`)
    expect((await runUpdateCheck()).updateAvailable).toBe(false)
    expect((await getUpdateNotice())?.updateAvailable).toBe(false)
  })

  it('does nothing when disabled', async () => {
    await updateSettings({ updateCheckEnabled: false })
    const fetchSpy = mockRelease('v99.0.0')
    expect(await runUpdateCheck()).toEqual({ checked: false, updateAvailable: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await getUpdateNotice()).toBeNull()
  })

  it('rejects on network failure without storing anything', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await expect(runUpdateCheck()).rejects.toThrow()
    expect(await getUpdateNotice()).toBeNull()
  })

  it('GET /api/admin/status includes update', async () => {
    const app = await buildTestApp()
    const admin = await createUser({ isAdmin: true })
    const before = await app.inject({ method: 'GET', url: '/api/admin/status', headers: authHeader(admin) })
    expect(before.json().update).toBeNull()
    mockRelease('v99.0.0')
    await runUpdateCheck()
    const after = await app.inject({ method: 'GET', url: '/api/admin/status', headers: authHeader(admin) })
    expect(after.json().update).toMatchObject({ latest: '99.0.0', updateAvailable: true })
    const settings = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: authHeader(admin) })
    expect(settings.json()).not.toHaveProperty('updateCheckResult')
    await app.close()
  })
})
