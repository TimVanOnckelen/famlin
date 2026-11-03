import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/db.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'

function payload(
  overrides: Partial<{
    platform: 'ios' | 'android'
    osVersion: string
    appVersion: string
    appBuild: string
    pushPermission: 'granted' | 'denied' | 'undetermined'
  }> = {}
) {
  return {
    platform: 'ios' as const,
    osVersion: '18.1',
    appVersion: '1.8.2',
    appBuild: '245',
    pushPermission: 'granted' as const,
    ...overrides,
  }
}

describe('mobile device diagnostics', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('requires authentication and returns only the member’s own devices', async () => {
    const member = await createUser()
    const other = await createUser()
    const installId = randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(member),
    })
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${randomUUID()}`,
      payload: payload(),
      headers: authHeader(other),
    })

    const unauthorized = await app.inject({ method: 'GET', url: '/api/devices/me' })
    expect(unauthorized.statusCode).toBe(401)

    const response = await app.inject({ method: 'GET', url: '/api/devices/me', headers: authHeader(member) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ installId, ...payload() }])
    expect(JSON.stringify(response.json())).not.toMatch(/createdAt|updatedAt|lastSeen/i)
  })

  it('upserts changed state and does not update an unchanged report', async () => {
    const member = await createUser()
    const installId = randomUUID()
    const first = await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(member),
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ success: true, changed: true })

    const device = await prisma.device.findUniqueOrThrow({ where: { installId } })
    const pushToken = await prisma.pushToken.create({
      data: { userId: member.id, token: `ExponentPushToken[${randomUUID()}]`, deviceId: device.id },
    })

    const unchanged = await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(member),
    })
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json()).toEqual({ success: true, changed: false })

    const changed = await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload({ pushPermission: 'denied' }),
      headers: authHeader(member),
    })
    expect(changed.json()).toEqual({ success: true, changed: true })
    expect(await prisma.pushToken.findUniqueOrThrow({ where: { id: pushToken.id } })).toMatchObject({
      userId: member.id,
      deviceId: device.id,
    })
  })

  it('rebinds a shared install to the new account and clears the previous account’s linked token', async () => {
    const previous = await createUser()
    const current = await createUser()
    const installId = randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(previous),
    })
    const device = await prisma.device.findUniqueOrThrow({ where: { installId } })
    const token = await prisma.pushToken.create({
      data: { userId: previous.id, token: `ExponentPushToken[${randomUUID()}]`, deviceId: device.id },
    })

    const response = await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(current),
    })
    expect(response.statusCode).toBe(200)
    expect(await prisma.device.findUniqueOrThrow({ where: { installId } })).toMatchObject({ userId: current.id })
    expect(await prisma.pushToken.findUnique({ where: { id: token.id } })).toBeNull()
  })

  it('associates a registered push token only with the caller’s reported installation', async () => {
    const member = await createUser()
    const installId = randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(member),
    })
    const device = await prisma.device.findUniqueOrThrow({ where: { installId } })
    const tokenValue = `ExponentPushToken[${randomUUID()}]`

    const response = await app.inject({
      method: 'POST',
      url: '/api/push-tokens',
      payload: { token: tokenValue, installId },
      headers: authHeader(member),
    })
    expect(response.statusCode).toBe(200)
    expect(await prisma.pushToken.findUniqueOrThrow({ where: { token: tokenValue } })).toMatchObject({
      userId: member.id,
      deviceId: device.id,
    })
  })

  it('enforces the 20-device cap and lets the owner remove a device', async () => {
    const member = await createUser()
    await prisma.device.createMany({
      data: Array.from({ length: 20 }, () => ({ userId: member.id, installId: randomUUID(), ...payload() })),
    })
    const limited = await app.inject({
      method: 'PUT',
      url: `/api/devices/${randomUUID()}`,
      payload: payload(),
      headers: authHeader(member),
    })
    expect(limited.statusCode).toBe(409)

    const ownDevice = await prisma.device.findFirstOrThrow({ where: { userId: member.id } })
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${ownDevice.installId}`,
      headers: authHeader(member),
    })
    expect(removed.statusCode).toBe(200)
    expect(await prisma.device.findUnique({ where: { installId: ownDevice.installId } })).toBeNull()
  })

  it('provides aggregate and per-member details to admins and supports manual removal', async () => {
    const admin = await createUser({ isAdmin: true })
    const member = await createUser({ name: 'Device Owner' })
    const installId = randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload({ appVersion: 'issue-336-test', pushPermission: 'denied' }),
      headers: authHeader(member),
    })

    const denied = await app.inject({ method: 'GET', url: '/api/admin/devices', headers: authHeader(member) })
    expect(denied.statusCode).toBe(403)

    const response = await app.inject({ method: 'GET', url: '/api/admin/devices', headers: authHeader(admin) })
    expect(response.statusCode).toBe(200)
    expect(response.json().summary.versions).toContainEqual({ appVersion: 'issue-336-test', platform: 'ios', count: 1 })
    expect(response.json().items).toContainEqual(
      expect.objectContaining({
        installId,
        pushPermission: 'denied',
        user: { id: member.id, name: member.name, email: member.email },
      })
    )

    const row = response.json().items.find((device: { installId: string }) => device.installId === installId)
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/devices/${row.id}`,
      headers: authHeader(admin),
    })
    expect(removed.statusCode).toBe(200)
    expect(await prisma.device.findUnique({ where: { installId } })).toBeNull()
  })

  it('cascades device rows when the member deletes their account', async () => {
    const member = await createUser()
    const installId = randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/api/devices/${installId}`,
      payload: payload(),
      headers: authHeader(member),
    })

    const response = await app.inject({ method: 'DELETE', url: '/api/auth/me', headers: authHeader(member) })
    expect(response.statusCode).toBe(200)
    expect(await prisma.device.findUnique({ where: { installId } })).toBeNull()
  })
})
