import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

// Regression tests for the famlin:// redirects issued by
// GET /api/auth/oidc/mobile-callback. The mobile app validates that the
// `state` it sent survives the whole round trip (CSRF binding — see
// performServerMediatedLogin in mobile/src/utils/oidcLogin.ts) and rejects
// any callback without it, so every redirect — success and error paths
// alike — must echo Google's `state` back. Dropping it broke Google sign-in
// on mobile even though the server-side exchange succeeded.

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/auth/oidc/mobile-callback', () => {
  const state = JSON.stringify({ nonce: 'abc123' });

  it('echoes state on the provider-error redirect', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/oidc/mobile-callback?error=access_denied&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('famlin://oidc-callback?error=access_denied');
    expect(location).toContain(`&state=${encodeURIComponent(state)}`);
  });

  it('echoes state on the login_failed redirect', async () => {
    // OIDC isn't configured in the test database, so the code exchange
    // throws OidcError('not_configured') and the handler takes the
    // login_failed path — the state echo must survive that too.
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/oidc/mobile-callback?code=fake-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('famlin://oidc-callback?error=login_failed');
    expect(location).toContain(`&state=${encodeURIComponent(state)}`);
  });

  it('still redirects without a state param (legacy/hand-typed requests)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/mobile-callback?error=access_denied',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('famlin://oidc-callback?error=access_denied');
  });
});
