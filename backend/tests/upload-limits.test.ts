import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { buildTestApp, createUser, authHeader, createGroupWithMember, createPost } from './helpers.js'
import { prisma } from '../src/db.js'
import { updateSettings } from '../src/services/settings.js'

// Issue #436: admin-configurable upload limits — maxAttachments caps every
// photo/video list, maxUploadSizeMb each uploaded file, and all three are
// published on /api/auth/server-info for the clients.

let app: FastifyInstance
let admin: Awaited<ReturnType<typeof createUser>>
let member: Awaited<ReturnType<typeof createUser>>
let groupId: string

const paths = (n: number) => Array.from({ length: n }, () => `/uploads/${randomUUID()}.jpg`)

beforeAll(async () => {
  app = await buildTestApp()
  admin = await createUser({ isAdmin: true })
  member = await createUser()
  groupId = (await createGroupWithMember(member)).id
})

afterEach(async () => {
  await prisma.setting.deleteMany({
    where: { key: { in: ['maxAttachments', 'maxVideoDurationSeconds', 'maxUploadSizeMb'] } },
  })
  await updateSettings({})
})

afterAll(async () => {
  await app.close()
})

describe('limit settings', () => {
  it('defaults to 10 attachments, 120 s videos and 200 MB on server-info', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/server-info' })
    expect(res.json().limits).toEqual({ maxAttachments: 10, maxVideoDurationSeconds: 120, maxUploadSizeMb: 200 })
    expect(res.json().features).toContain('configurableLimits')
  })

  it('accepts in-range values and publishes them', async () => {
    const payload = { maxAttachments: 30, maxVideoDurationSeconds: 600, maxUploadSizeMb: 1024 }
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: authHeader(admin), payload })
    expect(res.statusCode).toBe(200)
    const info = await app.inject({ method: 'GET', url: '/api/auth/server-info' })
    expect(info.json().limits).toEqual(payload)
  })

  it.each([
    { maxAttachments: 9 },
    { maxAttachments: 51 },
    { maxVideoDurationSeconds: 1801 },
    { maxUploadSizeMb: 5 },
    { maxUploadSizeMb: 2049 },
    { maxAttachments: 12.5 },
  ])('rejects out-of-range %o', async (payload) => {
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: authHeader(admin), payload })
    expect(res.statusCode).toBe(400)
  })
})

describe('maxAttachments', () => {
  it('allows a post at the default limit and rejects one over it', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(member),
      payload: { groupId, content: 'ten', uploadedAssetUrls: paths(10) },
    })
    expect(ok.statusCode).toBe(200)

    const over = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(member),
      payload: { groupId, content: 'eleven', uploadedAssetUrls: paths(11) },
    })
    expect(over.statusCode).toBe(400)
    expect(over.json()).toMatchObject({ code: 'tooManyAttachments', error: expect.stringContaining('10') })
  })

  it('follows the configured value on post create and edit', async () => {
    await updateSettings({ maxAttachments: 15 })
    const ok = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(member),
      payload: { groupId, content: 'fifteen', uploadedAssetUrls: paths(15) },
    })
    expect(ok.statusCode).toBe(200)

    const post = await createPost({ groupId, authorId: member.id })
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${post.id}`,
      headers: authHeader(member),
      payload: { uploadedAssetUrls: paths(16) },
    })
    expect(edit.statusCode).toBe(400)
    expect(edit.json().code).toBe('tooManyAttachments')
  })

  it('lets an edit keep a post that already holds more than the limit', async () => {
    const post = await createPost({ groupId, authorId: member.id })
    const legacy = paths(20)
    await prisma.post.update({ where: { id: post.id }, data: { uploadedAssetUrls: legacy } })
    const keep = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${post.id}`,
      headers: authHeader(member),
      payload: { content: 'edited', uploadedAssetUrls: legacy.slice(0, 19) },
    })
    expect(keep.statusCode).toBe(200)
    const grow = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${post.id}`,
      headers: authHeader(member),
      payload: { uploadedAssetUrls: paths(20) },
    })
    expect(grow.statusCode).toBe(400)
    expect(grow.json().code).toBe('tooManyAttachments')
  })

  it('caps comment attachments', async () => {
    const post = await createPost({ groupId, authorId: member.id })
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${post.id}/comments`,
      headers: authHeader(member),
      payload: { attachmentUrls: paths(11) },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('tooManyAttachments')
  })
})

describe('POST /api/uploads', () => {
  it('accepts a full selection of Live Photos (two files each) in one request', async () => {
    const boundary = '----FamlinFilesBoundary'
    const part = (i: number) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f${i}.gif"\r\nContent-Type: image/gif\r\n\r\nGIF89a\r\n`
    const payload = Array.from({ length: 20 }, (_, i) => part(i)).join('') + `--${boundary}--\r\n`
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().urls).toHaveLength(20)
  })
})

describe('maxUploadSizeMb', () => {
  it('rejects a file over the configured size with 413', async () => {
    await updateSettings({ maxUploadSizeMb: 10 })
    const boundary = '----FamlinLimitBoundary'
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      Buffer.alloc(10 * 1024 * 1024 + 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...authHeader(member), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toContain('10')
  })
})
