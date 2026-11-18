import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/db.js'
import { dataDir } from '../src/config.js'
import { generateApiToken } from '../src/services/apiTokens.js'
import { clearSetupCode, getSetupCode, SETUP_CODE_FILE } from '../src/services/setupCode.js'
import { authHeader, buildTestApp, createUser } from './helpers.js'

// Security hardening: the one-time setup code on the first-run routes,
// server-side sessions (logout, device list, revocation, forced sign-out),
// and re-authentication before an email change.

let app: FastifyInstance
let ip = 0
// Login and setup are rate limited per IP; each call gets its own address.
const nextAddress = () => `10.9.${Math.floor(++ip / 250)}.${ip % 250}`

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

async function login(email: string, password: string, userAgent = 'TestAgent/1.0') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: nextAddress(),
    headers: { 'user-agent': userAgent },
    payload: { email, password },
  })
  expect(res.statusCode).toBe(200)
  return res.json().token as string
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('first-run setup code', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany()
    clearSetupCode()
  })

  const setup = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      remoteAddress: nextAddress(),
      headers,
      payload: { email: 'owner@example.com', name: 'Owner', password: 'password1234' },
    })

  it('refuses setup without the code, or with a wrong one, and creates no account', async () => {
    const missing = await setup({})
    expect(missing.statusCode).toBe(403)
    expect(missing.json().code).toBe('setupCodeInvalid')

    const wrong = await setup({ 'x-setup-code': 'AAAA-BBBB-CCCC' })
    expect(wrong.statusCode).toBe(403)
    expect(await prisma.user.count()).toBe(0)
  })

  it('accepts the code regardless of case, spaces and dashes, then deletes it', async () => {
    const code = getSetupCode()
    const file = path.join(dataDir, SETUP_CODE_FILE)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)

    const res = await setup({ 'x-setup-code': ` ${code.replace(/-/g, ' ').toLowerCase()} ` })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.isAdmin).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('keeps the same code until setup succeeds', () => {
    expect(getSetupCode()).toBe(getSetupCode())
  })

  it('guards every restore route too, before reading the request', async () => {
    for (const [method, url] of [
      ['GET', '/api/auth/setup/backups'],
      ['GET', '/api/auth/setup/dumps'],
      ['POST', '/api/auth/setup/restore-backup'],
      ['POST', '/api/auth/setup/restore-dump'],
      ['POST', '/api/auth/setup/restore'],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        remoteAddress: nextAddress(),
        payload: method === 'POST' ? {} : undefined,
      })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().code, url).toBe('setupCodeInvalid')
    }
  })
})

describe('server-side sessions', () => {
  const password = 'correct-horse-1'
  let user: Awaited<ReturnType<typeof createUser>>

  beforeEach(async () => {
    await prisma.user.deleteMany()
    user = await createUser({ email: `sessions-${Date.now()}@example.com`, password })
  })

  it('creates one session per sign-in, labelled with the User-Agent', async () => {
    await login(user.email, password, 'Phone/1')
    const token = await login(user.email, password, 'Laptop/2')

    const res = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: bearer(token) })
    expect(res.statusCode).toBe(200)
    const { items, currentListed } = res.json()
    expect(currentListed).toBe(true)
    expect(items.map((s: { userAgent: string }) => s.userAgent).sort()).toEqual(['Laptop/2', 'Phone/1'])
    expect(items.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
    expect(items.find((s: { current: boolean }) => s.current).userAgent).toBe('Laptop/2')
  })

  it('logout ends the session on the server: the token and its media token stop working', async () => {
    const token = await login(user.email, password)
    const media = await app.inject({ method: 'GET', url: '/api/uploads/media-token', headers: bearer(token) })
    const mediaToken = media.json().token as string

    // A missing file is a 404 once authorized; an unauthorized token is a 401.
    const before = await app.inject({ method: 'GET', url: `/uploads/missing.jpg?token=${mediaToken}` })
    expect(before.statusCode).toBe(404)

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(token) })
    expect(out.statusCode).toBe(200)

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })
    expect(me.statusCode).toBe(401)
    const after = await app.inject({ method: 'GET', url: `/uploads/missing.jpg?token=${mediaToken}` })
    expect(after.statusCode).toBe(401)
  })

  it('revokes one device, and 404s for another account’s session', async () => {
    const phone = await login(user.email, password, 'Phone/1')
    const laptop = await login(user.email, password, 'Laptop/2')
    const other = await createUser({ email: `other-${Date.now()}@example.com`, password })
    const otherToken = await login(other.email, password)

    const list = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: bearer(laptop) })
    const phoneSession = list.json().items.find((s: { userAgent: string }) => s.userAgent === 'Phone/1')

    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${phoneSession.id}`,
      headers: bearer(otherToken),
    })
    expect(foreign.statusCode).toBe(404)

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${phoneSession.id}`,
      headers: bearer(laptop),
    })
    expect(revoke.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(phone) })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(laptop) })).statusCode).toBe(200)
  })

  it('signs out every other device but keeps the current one', async () => {
    const phone = await login(user.email, password, 'Phone/1')
    const tablet = await login(user.email, password, 'Tablet/1')
    const laptop = await login(user.email, password, 'Laptop/2')

    const res = await app.inject({ method: 'DELETE', url: '/api/auth/sessions', headers: bearer(laptop) })
    expect(res.statusCode).toBe(200)
    expect(res.json().revoked).toBe(2)
    for (const token of [phone, tablet]) {
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(401)
    }
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(laptop) })).statusCode).toBe(200)
  })

  it('a password change ends every session', async () => {
    const phone = await login(user.email, password, 'Phone/1')
    const laptop = await login(user.email, password, 'Laptop/2')
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(laptop),
      payload: { currentPassword: password, newPassword: 'another-pass-2' },
    })
    expect(res.statusCode).toBe(200)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(phone) })).statusCode).toBe(401)
  })

  it('an admin can sign a user out everywhere, legacy tokens included', async () => {
    const admin = await createUser({ isAdmin: true })
    const session = await login(user.email, password)
    const legacy = authHeader(user) // a token without a session id

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/sign-out`,
      headers: authHeader(admin),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().revoked).toBe(1)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(session) })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: legacy })).statusCode).toBe(401)

    const notAdmin = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${admin.id}/sign-out`,
      headers: authHeader(user),
    })
    expect(notAdmin.statusCode).not.toBe(200)
  })

  it('personal access tokens can neither list nor revoke sessions', async () => {
    const { token, tokenHash, tokenPreview } = generateApiToken()
    await prisma.apiToken.create({ data: { userId: user.id, name: 'script', tokenHash, tokenPreview } })
    for (const [method, url] of [
      ['GET', '/api/auth/sessions'],
      ['DELETE', '/api/auth/sessions'],
    ] as const) {
      const res = await app.inject({ method, url, headers: bearer(token) })
      expect(res.statusCode, url).toBe(403)
    }
  })

  it('still accepts tokens issued before sessions existed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(user) })
    expect(res.statusCode).toBe(200)
  })

  it('refuses a token whose session has expired', async () => {
    const token = await login(user.email, password)
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(401)
  })
})

describe('changing the email address', () => {
  const password = 'correct-horse-1'

  beforeEach(async () => {
    await prisma.user.deleteMany()
  })

  const patchMe = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/auth/me', headers, payload })

  it('needs the current password on an account that has one', async () => {
    const user = await createUser({ email: 'old@example.com', password })
    const token = await login(user.email, password)

    const missing = await patchMe(bearer(token), { email: 'new@example.com' })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().code).toBe('currentPasswordRequired')

    const wrong = await patchMe(bearer(token), { email: 'new@example.com', currentPassword: 'nope-nope' })
    // 403, never 401: a 401 would make clients sign the user out.
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().code).toBe('currentPasswordIncorrect')
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('old@example.com')

    const ok = await patchMe(bearer(token), { email: 'new@example.com', currentPassword: password })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().email).toBe('new@example.com')
    expect(ok.json()).not.toHaveProperty('currentPassword')
  })

  it('needs nothing extra when the address is unchanged or only other fields change', async () => {
    const user = await createUser({ email: 'same@example.com', password })
    const token = await login(user.email, password)
    const res = await patchMe(bearer(token), { email: 'SAME@example.com', name: 'Renamed' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Renamed')
  })

  it('is refused with a personal access token, even with the password', async () => {
    const user = await createUser({ email: 'pat@example.com', password })
    const { token, tokenHash, tokenPreview } = generateApiToken()
    await prisma.apiToken.create({ data: { userId: user.id, name: 'script', tokenHash, tokenPreview } })
    const res = await patchMe(bearer(token), { email: 'thief@example.com', currentPassword: password })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('sessionRequired')
  })

  it('without a password, needs a sign-in from the last few minutes', async () => {
    const user = await createUser({ email: 'sso@example.com' })
    const session = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const { createUserToken } = await import('../src/plugins/auth.js')
    const token = createUserToken(user, session.id)

    const fresh = await patchMe(bearer(token), { email: 'sso-new@example.com' })
    expect(fresh.statusCode).toBe(200)

    await prisma.session.update({ where: { id: session.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } })
    const stale = await patchMe(bearer(token), { email: 'sso-newer@example.com' })
    expect(stale.statusCode).toBe(403)
    expect(stale.json().code).toBe('recentSignInRequired')

    // A pre-sessions token can't prove a recent sign-in either.
    const legacy = await patchMe(authHeader({ ...user, email: 'sso-new@example.com' }), { email: 'x@example.com' })
    expect(legacy.statusCode).toBe(403)
  })
})
