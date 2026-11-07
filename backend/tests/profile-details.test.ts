import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'

describe('self-service profile details', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await buildTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('normalizes details, keeps the session valid, and uses the new email for password login', async () => {
    const user = await createUser({ password: 'profile-password-123' })
    const email = `updated-${user.id}@example.com`
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeader(user),
      payload: { name: '  Updated Name  ', email: `  ${email.toUpperCase()}  ` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: user.id, name: 'Updated Name', email })
    expect(response.json()).not.toHaveProperty('passwordHash')
    const current = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(user) })
    expect(current.json()).toMatchObject({ name: 'Updated Name', email })
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'profile-password-123' },
    })
    expect(login.statusCode).toBe(200)
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'profile-password-123' },
    })
    expect(oldLogin.statusCode).toBe(401)
  })

  it('allows keeping the current address and updating only the name', async () => {
    const user = await createUser()
    for (const payload of [{ name: 'First', email: user.email.toUpperCase() }, { name: 'Second' }]) {
      const response = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: authHeader(user), payload })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ name: payload.name, email: user.email })
    }
  })

  it('rejects a case-insensitive conflict without applying either field', async () => {
    const user = await createUser()
    const other = await createUser({ email: 'Legacy.MixedCase@example.com' })
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeader(user),
      payload: { name: 'Must not apply', email: other.email.toLowerCase() },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'This email address is already in use' })
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      name: user.name,
      email: user.email,
    })
  })

  it.each([{ name: '   ' }, { name: 'n'.repeat(101) }, { email: 'invalid' }, { email: null }])(
    'validates profile fields: %j',
    async (payload) => {
      const user = await createUser()
      const response = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: authHeader(user), payload })
      expect(response.statusCode).toBe(400)
    }
  )

  it('returns 409 if the database unique constraint catches a concurrent claim', async () => {
    const user = await createUser()
    const update = vi
      .spyOn(prisma.user, 'update')
      .mockRejectedValueOnce(Object.assign(new Error('unique constraint'), { code: 'P2002' }))
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/auth/me',
        headers: authHeader(user),
        payload: { email: 'race@example.com' },
      })
      expect(response.statusCode).toBe(409)
    } finally {
      update.mockRestore()
    }
  })

  it('allows only one of two users to claim the same address', async () => {
    const users = await Promise.all([createUser(), createUser()])
    const email = `claimed-${users[0].id}@example.com`
    const responses = await Promise.all(
      users.map((user) =>
        app.inject({ method: 'PATCH', url: '/api/auth/me', headers: authHeader(user), payload: { email } })
      )
    )
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect(await prisma.user.count({ where: { email } })).toBe(1)
  })

  it('requires authentication and does not allow privilege changes', async () => {
    const user = await createUser()
    const denied = await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { name: 'Anonymous' } })
    expect(denied.statusCode).toBe(401)
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeader(user),
      payload: { name: 'Member', isAdmin: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().isAdmin).toBe(false)
  })
})
