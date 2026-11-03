import { beforeAll, afterAll, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { prisma } from '../src/db.js'
import { getStorage } from '../src/services/storage/registry.js'
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js'

let app: FastifyInstance
let headers: Record<string, string>
let outsiderHeaders: Record<string, string>
const key = randomUUID()
const filename = `${key}.jpg`
const url = `/uploads/${filename}`
const bytes = Buffer.from('gallery-test-image')

beforeAll(async () => {
  app = await buildTestApp()
  const user = await createUser()
  const group = await createGroupWithMember(user)
  const outsider = await createUser()
  headers = authHeader(user)
  outsiderHeaders = authHeader(outsider)
  await prisma.upload.create({ data: { assetKey: key, uploaderId: user.id, bound: true, groupIds: [group.id] } })
  await getStorage().put(filename, bytes)
})

afterAll(async () => {
  await getStorage().delete(filename)
  await app.close()
})

it('serves 500 gallery images without consuming the shared API budget', async () => {
  const remoteAddress = '203.0.113.10'
  for (let i = 0; i < 500; i++) {
    const response = await app.inject({ method: 'GET', url, headers, remoteAddress })
    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(bytes)
    expect(response.headers['x-ratelimit-limit']).toBeUndefined()
  }
  const head = await app.inject({ method: 'HEAD', url, headers, remoteAddress })
  expect(head.statusCode).toBe(200)
  expect(head.headers['x-ratelimit-limit']).toBeUndefined()

  const api = await app.inject({ method: 'GET', url: '/api/auth/setup-status', remoteAddress })
  expect(api.statusCode).toBe(200)
  expect(api.headers['x-ratelimit-limit']).toBe('300')
  expect(api.headers['x-ratelimit-remaining']).toBe('299')

  for (let i = 1; i < 300; i++) {
    expect((await app.inject({ method: 'GET', url: '/api/auth/setup-status', remoteAddress })).statusCode).toBe(200)
  }
  expect((await app.inject({ method: 'GET', url: '/api/auth/setup-status', remoteAddress })).statusCode).toBe(429)
  expect((await app.inject({ method: 'GET', url, headers, remoteAddress })).statusCode).toBe(200)
})

it('still requires authentication and group access for media reads', async () => {
  expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
  expect((await app.inject({ method: 'GET', url, headers: outsiderHeaders })).statusCode).toBe(404)
  expect((await app.inject({ method: 'HEAD', url, headers: outsiderHeaders })).statusCode).toBe(404)
  expect((await app.inject({ method: 'GET', url: `/uploads/originals/${filename}`, headers })).statusCode).toBe(404)
})

it('keeps the separate rate limit on POST /api/uploads', async () => {
  const remoteAddress = '203.0.113.11'
  for (let i = 0; i < 60; i++) {
    const response = await app.inject({ method: 'POST', url: '/api/uploads', headers, remoteAddress })
    expect(response.headers['x-ratelimit-limit']).toBe('60')
    expect(response.statusCode).not.toBe(429)
  }
  const blocked = await app.inject({ method: 'POST', url: '/api/uploads', headers, remoteAddress })
  expect(blocked.statusCode).toBe(429)
  expect(blocked.headers['retry-after']).toBeDefined()
})
