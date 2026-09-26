import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { prisma } from '../src/db.js';
import { updateSettings } from '../src/services/settings.js';
import { buildTestApp, createUser } from './helpers.js';

// Accounts are matched on email alone, so an OIDC login must not accept an
// email the provider itself says is unverified — otherwise anyone who can
// self-register that address at the provider signs into the existing
// Famlin account for it (e.g. the admin's).

const ISSUER = 'https://idp.email-verified.test';
const CLIENT_ID = 'famlin-email-verified-test';

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let app: FastifyInstance;
const realFetch = globalThis.fetch;

async function idToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/jwks`,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
      });
    }
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [publicJwk] });
    return realFetch(input, init);
  });

  await updateSettings({ oidcIssuer: ISSUER, oidcClientId: CLIENT_ID, allowedEmails: [] });
});

afterAll(async () => {
  await updateSettings({ oidcIssuer: '', oidcClientId: '' });
  vi.unstubAllGlobals();
});

// Fresh app per test: /oidc is rate-limited per IP and every injected
// request shares one.
beforeEach(async () => {
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

describe('OIDC email_verified', () => {
  it('refuses to sign into an existing account with an unverified email', async () => {
    const admin = await createUser({ email: 'owner-unverified@example.com', isAdmin: true });

    for (const emailVerified of [false, 'false']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc',
        payload: { idToken: await idToken({ sub: 'attacker', email: admin.email, email_verified: emailVerified }) },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().token).toBeUndefined();
    }
  });

  it('does not provision a new account for an unverified email either', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oidc',
      payload: { idToken: await idToken({ sub: 'x', email: 'brand-new-unverified@example.com', email_verified: false }) },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: 'brand-new-unverified@example.com' } })).toBeNull();
  });

  it('accepts a verified email', async () => {
    const user = await createUser({ email: 'owner-verified@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oidc',
      payload: { idToken: await idToken({ sub: 'owner', email: user.email, email_verified: true }) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });

  it('accepts a token without the claim (providers such as Entra never send it)', async () => {
    const user = await createUser({ email: 'owner-noclaim@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oidc',
      payload: { idToken: await idToken({ sub: 'owner', email: user.email }) },
    });
    expect(res.statusCode).toBe(200);
  });
});
