import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWTVerifyGetKey } from 'jose'
import { prisma } from '../src/db.js'
import { updateSettings } from '../src/services/settings.js'
import { appleDeps, appleNonceFor } from '../src/services/appleLogin.js'
import { buildTestApp, createUser } from './helpers.js'

// Every Famlin server accepts Apple identity tokens minted for the same
// shared app, so a token one server receives must not log in on another.
// The app binds the token to the server it talks to through the nonce
// (services/appleLogin.ts); these tests pin that binding.

const APPLE_ISSUER = 'https://appleid.apple.com'
const AUDIENCE = 'be.xeweb.famlin'
// app.inject() sends `Host: localhost:80`.

let privateKey: CryptoKey
let app: FastifyInstance
let realJwks: JWTVerifyGetKey

async function identityToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
    .setIssuer(APPLE_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function login(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/auth/apple', payload: body })
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'apple-test-key', alg: 'RS256', use: 'sig' }
  realJwks = appleDeps.jwks
  appleDeps.jwks = createLocalJWKSet({ keys: [publicJwk] })
  app = await buildTestApp()
})

afterAll(async () => {
  appleDeps.jwks = realJwks
  await app.close()
})

afterEach(async () => {
  await updateSettings({ publicUrl: '' })
})

function bound(email: string, nonceHost: string) {
  const rawNonce = crypto.randomUUID()
  return identityToken({ email, nonce: appleNonceFor(nonceHost, rawNonce) }).then((token) => ({
    identityToken: token,
    rawNonce,
    nonceHost,
  }))
}

describe('POST /api/auth/apple nonce binding', () => {
  it('accepts a token bound to the host the request reached', async () => {
    const user = await createUser()
    const res = await login(await bound(user.email, 'localhost'))
    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(user.id)
  })

  it('ignores the port, which a proxy forwarding `Host $host` drops', async () => {
    const user = await createUser()
    const res = await login(await bound(user.email, 'localhost:8443'))
    expect(res.statusCode).toBe(200)
  })

  it('rejects a token requested for another server (cross-server replay)', async () => {
    const user = await createUser()
    const res = await login(await bound(user.email, 'evil.example'))
    expect(res.statusCode).toBe(401)
  })

  it('rejects a nonceHost that is not the one the token was hashed with', async () => {
    const user = await createUser()
    const body = await bound(user.email, 'evil.example')
    const res = await login({ ...body, nonceHost: 'localhost' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a nonce-bound token sent without its raw nonce', async () => {
    const user = await createUser()
    const { identityToken: token, nonceHost } = await bound(user.email, 'localhost')
    const res = await login({ identityToken: token, nonceHost })
    expect(res.statusCode).toBe(401)
  })

  it('with publicUrl set, accepts only its host — a spoofed Host header does not help', async () => {
    const user = await createUser()
    await updateSettings({ publicUrl: 'https://Family.Example.com' })

    expect((await login(await bound(user.email, 'family.example.com'))).statusCode).toBe(200)

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/apple',
      headers: { host: 'evil.example' },
      payload: await bound(user.email, 'evil.example'),
    })
    expect(replay.statusCode).toBe(401)
  })

  it('never trusts X-Forwarded-Host', async () => {
    const user = await createUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/apple',
      headers: { 'x-forwarded-host': 'evil.example' },
      payload: await bound(user.email, 'evil.example'),
    })
    expect(res.statusCode).toBe(401)
  })

  // Older app builds don't send a nonce yet; they keep working until
  // MIN_APP_VERSION excludes them.
  it('still accepts a legacy token without any nonce', async () => {
    const user = await createUser()
    const res = await login({ identityToken: await identityToken({ email: user.email }) })
    expect(res.statusCode).toBe(200)
    expect(await prisma.user.count({ where: { email: user.email } })).toBe(1)
  })
})
