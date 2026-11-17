import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '../src/db.js'
import { updateSettings, __resetSettingsCacheForTests } from '../src/services/settings.js'
import { __resetIntegrationChecksForTests } from '../src/services/integrations.js'
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js'

describe('GET /api/admin/integrations', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    __resetIntegrationChecksForTests()
    __resetSettingsCacheForTests()
  })

  const overview = async (user: Parameters<typeof authHeader>[0], query = '') =>
    app.inject({ method: 'GET', url: `/api/admin/integrations${query}`, headers: authHeader(user) })

  it('is admin-only', async () => {
    const member = await createUser()
    expect((await overview(member)).statusCode).toBe(403)
  })

  it('lists every integration, with unset ones off and built-in ones on', async () => {
    const admin = await createUser({ isAdmin: true })
    const res = await overview(admin, '?check=1')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.checkedAt).toBeTruthy()
    const byId = Object.fromEntries(body.integrations.map((i: { id: string }) => [i.id, i]))
    expect(Object.keys(byId)).toEqual(['immich', 'local', 'sso', 'apple', 'email', 'push', 'storage'])
    expect(byId.immich).toMatchObject({ state: 'off', configured: false })
    expect(byId.email).toMatchObject({ state: 'off' })
    expect(byId.apple).toMatchObject({ state: 'ok' })
    expect(byId.storage).toMatchObject({ state: 'ok', usage: { driver: 'local' } })
    expect(byId.immich.jobs).toEqual(['newAssets', 'mediaMirror'])
  })

  it('reports a failing local folder and per-family usage', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin)
    await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: 'local', externalAlbumId: 'summer', albumName: 'Summer' },
    })
    await updateSettings({ localMediaPath: `/nonexistent-${randomUUID()}` })

    const local = (await overview(admin, '?check=1')).json().integrations.find((i: { id: string }) => i.id === 'local')
    expect(local).toMatchObject({
      state: 'failing',
      issues: ['checkFailed'],
      check: { ok: false, error: 'not_found' },
      usage: { families: 1, albums: 1 },
    })
  })

  it('flags mirror failures on Immich', async () => {
    const admin = await createUser({ isAdmin: true })
    await prisma.mediaMirror.create({
      data: { provider: 'immich', externalAlbumId: randomUUID(), assetKey: randomUUID(), status: 'failed' },
    })
    const immich = (await overview(admin)).json().integrations.find((i: { id: string }) => i.id === 'immich')
    expect(immich.issues).toContain('mirrorFailures')
    expect(immich.usage.mirrorFailures).toBe(1)
    await prisma.mediaMirror.deleteMany()
  })
})
