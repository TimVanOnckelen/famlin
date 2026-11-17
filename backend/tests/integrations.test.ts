import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import os from 'os'
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
    expect(byId.immich.jobs.map((j: { job: string }) => j.job)).toEqual(['newAssets', 'mediaMirror'])
    // Nothing to fix on an integration that isn't set up, e.g. the missing
    // public address that only matters once email is.
    expect(byId.email.issues).toEqual([])
    expect(byId.immich.issues).toEqual([])
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

  it('flags mirror failures on a connected Immich', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin)
    const albumId = randomUUID()
    await prisma.mediaMirrorTarget.create({
      data: { groupId: group.id, externalAlbumId: albumId, albumName: 'Famlin', mirrorSince: new Date() },
    })
    await prisma.mediaMirror.create({
      data: { provider: 'immich', externalAlbumId: albumId, assetKey: randomUUID(), status: 'failed' },
    })
    await updateSettings({ immichServerUrl: 'http://immich.test', immichApiKey: 'read', immichMirrorApiKey: 'write' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      const immich = (await overview(admin, '?check=1'))
        .json()
        .integrations.find((i: { id: string }) => i.id === 'immich')
      expect(immich).toMatchObject({ state: 'attention', issues: ['mirrorFailures'] })
    } finally {
      fetchMock.mockRestore()
      await updateSettings({ immichServerUrl: '', immichApiKey: '', immichMirrorApiKey: '' })
      await prisma.mediaMirror.deleteMany()
      await prisma.mediaMirrorTarget.deleteMany()
    }
  })

  it('forgets cached checks when settings are saved', async () => {
    const admin = await createUser({ isAdmin: true })
    const missing = `/nonexistent-${randomUUID()}`
    await updateSettings({ localMediaPath: missing })
    const before = (await overview(admin)).json().integrations.find((i: { id: string }) => i.id === 'local')
    expect(before.state).toBe('failing')

    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: authHeader(admin),
      payload: { localMediaPath: os.tmpdir() },
    })
    expect(saved.statusCode).toBe(200)
    const after = (await overview(admin)).json().integrations.find((i: { id: string }) => i.id === 'local')
    expect(after).toMatchObject({ state: 'ok', check: { ok: true } })
  })

  it('lists each family with its albums and upload mirror', async () => {
    const admin = await createUser({ isAdmin: true })
    const group = await createGroupWithMember(admin, { name: 'Peeters' })
    await prisma.mediaAlbumLink.create({
      data: { groupId: group.id, provider: 'immich', externalAlbumId: randomUUID(), albumName: 'Summer' },
    })
    const albumId = randomUUID()
    await prisma.mediaMirrorTarget.create({
      data: { groupId: group.id, externalAlbumId: albumId, albumName: 'Famlin – Peeters', mirrorSince: new Date() },
    })
    await prisma.mediaMirror.create({
      data: { provider: 'immich', externalAlbumId: albumId, assetKey: randomUUID(), status: 'mirrored' },
    })
    const immich = (await overview(admin)).json().integrations.find((i: { id: string }) => i.id === 'immich')
    expect(immich.families.find((f: { groupId: string }) => f.groupId === group.id)).toEqual({
      groupId: group.id,
      name: 'Peeters',
      albums: ['Summer'],
      mirror: { albumName: 'Famlin – Peeters', enabled: true, mirrored: 1, failed: 0 },
    })
    await prisma.mediaMirror.deleteMany()
    await prisma.mediaMirrorTarget.deleteMany()
  })
})
