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
// app.inject() sends `Host: localhost:80`, which normalizes to `localhost`.
const SERVER_HOST = 'localhost'

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

describe('POST /api/auth/apple nonce binding', () => {
  it('accepts a token whose nonce is bound to this server', async () => {
    const user = await createUser()
    const rawNonce = crypto.randomBytes(16).toString('hex')
    const token = await identityToken({ email: user.email, nonce: appleNonceFor(SERVER_HOST, rawNonce) })

    const res = await login({ identityToken: token, rawNonce })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(user.id)
  })

  it('rejects a token requested for another server (cross-server replay)', async () => {
    const user = await createUser()
    const rawNonce = crypto.randomBytes(16).toString('hex')
    const token = await identityToken({ email: user.email, nonce: appleNonceFor('evil.example', rawNonce) })

    const res = await login({ identityToken: token, rawNonce })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a nonce-bound token sent without its raw nonce', async () => {
    const user = await createUser()
    const token = await identityToken({ email: user.email, nonce: appleNonceFor(SERVER_HOST, 'a'.repeat(32)) })

    const res = await login({ identityToken: token })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a raw nonce when the token carries none', async () => {
    const user = await createUser()
    const token = await identityToken({ email: user.email })

    const res = await login({ identityToken: token, rawNonce: 'b'.repeat(32) })
    expect(res.statusCode).toBe(401)
  })

  it('accepts a token bound to the configured publicUrl host', async () => {
    const user = await createUser()
    await updateSettings({ publicUrl: 'https://Family.Example.com' })
    const rawNonce = crypto.randomBytes(16).toString('hex')
    const token = await identityToken({ email: user.email, nonce: appleNonceFor('family.example.com', rawNonce) })

    const res = await login({ identityToken: token, rawNonce })
    expect(res.statusCode).toBe(200)
  })

  // Older app builds don't send a nonce yet; they keep working until
  // MIN_APP_VERSION excludes them.
  it('still accepts a legacy token without any nonce', async () => {
    const user = await createUser()
    const token = await identityToken({ email: user.email })

    const res = await login({ identityToken: token })
    expect(res.statusCode).toBe(200)
    expect(await prisma.user.count({ where: { email: user.email } })).toBe(1)
  })
})
