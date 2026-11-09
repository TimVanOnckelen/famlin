import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { uploadsDir } from '../src/config.js'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { buildTestApp, createUser, createGroupWithMember, createPost, createComment, authHeader } from './helpers.js'

describe('GET /api/admin/export', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('401s when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/export' })
    expect(res.statusCode).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const nonAdmin = await createUser()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(nonAdmin),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns a zip stream for an admin', async () => {
    const admin = await createUser({ isAdmin: true })
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    // Local file header signature ("PK\x03\x04") that every zip starts with.
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('includes seeded family content in the archive', async () => {
    const admin = await createUser({ isAdmin: true, password: 'super-secret-pw' })
    await prisma.device.create({
      data: {
        userId: admin.id,
        installId: randomUUID(),
        platform: 'ios',
        osVersion: '18.1',
        appVersion: 'admin-export-device-secret',
        appBuild: '245',
        pushPermission: 'granted',
      },
    })
    const group = await createGroupWithMember(admin)
    const post = await createPost({
      groupId: group.id,
      authorId: admin.id,
      content: 'A very distinctive post body for the export test',
    })
    await createComment({ postId: post.id, authorId: admin.id, content: 'A comment' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    })

    expect(res.statusCode).toBe(200)
    // Store-mode zip: JSON entries aren't deflated, so their bytes appear
    // verbatim in the raw archive body — good enough to assert presence
    // without pulling in a zip-reading library.
    const body = res.rawPayload.toString('latin1')

    expect(body).toContain('manifest.json')
    expect(body).toContain('data/users.json')
    expect(body).toContain('data/posts.json')
    expect(body).toContain(admin.email)
    expect(body).toContain('A very distinctive post body for the export test')
    expect(body).not.toContain('admin-export-device-secret')
    expect(body).not.toContain('data/devices.json')
  })

  it('omits media bytes but retains required keys, sizes and branding when includeMedia=false', async () => {
    const admin = await createUser({ isAdmin: true })
    const key = `${randomUUID()}.jpg`
    await fs.writeFile(path.join(uploadsDir, key), 'distinctive-media-payload')
    await fs.mkdir(path.join(uploadsDir, 'branding'), { recursive: true })
    const brand = `export-${randomUUID()}.png`
    await fs.writeFile(path.join(uploadsDir, 'branding', brand), 'distinctive-branding-payload')
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/export?includeMedia=false',
        headers: authHeader(admin),
      })
      expect(res.statusCode).toBe(200)
      const body = res.rawPayload.toString('utf8')
      expect(body).toContain('"includeMedia": false')
      expect(body).toContain(`"key": "${key}"`)
      expect(body).toContain('"size": 25')
      expect(body).not.toContain('distinctive-media-payload')
      expect(body).toContain('distinctive-branding-payload')
      expect(body).not.toContain('StorageMigration')
    } finally {
      await fs.rm(path.join(uploadsDir, key), { force: true })
      await fs.rm(path.join(uploadsDir, 'branding', brand), { force: true })
    }
  })

  it('never includes password hashes', async () => {
    const admin = await createUser({ isAdmin: true, password: 'super-secret-pw' })
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { passwordHash: true },
    })
    expect(stored.passwordHash).toBeTruthy()

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export',
      headers: authHeader(admin),
    })

    expect(res.statusCode).toBe(200)
    const body = res.rawPayload.toString('latin1')

    expect(body).not.toContain('passwordHash')
    expect(body).not.toContain(stored.passwordHash as string)
  })
})

describe('export download tokens', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    vi.useRealTimers()
    await app.close()
  })

  async function issueToken(user: Parameters<typeof authHeader>[0]) {
    const res = await app.inject({ method: 'POST', url: '/api/admin/export/token', headers: authHeader(user) })
    expect(res.statusCode).toBe(200)
    return res.json().token as string
  }

  it('401s without auth and 403s for a non-admin', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/admin/export/token' })).statusCode).toBe(401)
    const nonAdmin = await createUser()
    const res = await app.inject({ method: 'POST', url: '/api/admin/export/token', headers: authHeader(nonAdmin) })
    expect(res.statusCode).toBe(403)
  })

  it('refuses to issue a token to an API token', async () => {
    const admin = await createUser({ isAdmin: true })
    const pat = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: authHeader(admin),
      payload: { name: 'script' },
    })
    expect(pat.statusCode).toBe(201)
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/export/token',
      headers: { authorization: `Bearer ${pat.json().token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('downloads the export once with the token, without an Authorization header', async () => {
    const admin = await createUser({ isAdmin: true })
    const token = await issueToken(admin)

    const res = await app.inject({ method: 'GET', url: `/api/admin/export?includeMedia=false&downloadToken=${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="famlin-export-\d{4}-\d{2}-\d{2}\.zip"$/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK')

    const again = await app.inject({
      method: 'GET',
      url: `/api/admin/export?includeMedia=false&downloadToken=${token}`,
    })
    expect(again.statusCode).toBe(401)
  })

  it('rejects an unknown or expired token', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/api/admin/export?downloadToken=nope' })
    expect(unknown.statusCode).toBe(401)

    const admin = await createUser({ isAdmin: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const token = await issueToken(admin)
      vi.setSystemTime(Date.now() + 61_000)
      const res = await app.inject({ method: 'GET', url: `/api/admin/export?downloadToken=${token}` })
      expect(res.statusCode).toBe(401)
    } finally {
      vi.useRealTimers()
    }
  })

  it('403s when the token holder is no longer an admin, 401s after a sign-out', async () => {
    const admin = await createUser({ isAdmin: true })
    const token = await issueToken(admin)
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: false } })
    const demoted = await app.inject({ method: 'GET', url: `/api/admin/export?downloadToken=${token}` })
    expect(demoted.statusCode).toBe(403)

    const other = await createUser({ isAdmin: true })
    const otherToken = await issueToken(other)
    await prisma.user.update({ where: { id: other.id }, data: { tokenVersion: { increment: 1 } } })
    const signedOut = await app.inject({ method: 'GET', url: `/api/admin/export?downloadToken=${otherToken}` })
    expect(signedOut.statusCode).toBe(401)
  })

  it('only accepts the token on the export route', async () => {
    const admin = await createUser({ isAdmin: true })
    const token = await issueToken(admin)
    const res = await app.inject({ method: 'GET', url: `/api/admin/stats?downloadToken=${token}` })
    expect(res.statusCode).toBe(401)
  })

  it('still works with the Authorization header, no-store included', async () => {
    const admin = await createUser({ isAdmin: true })
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/export?includeMedia=false',
      headers: authHeader(admin),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
