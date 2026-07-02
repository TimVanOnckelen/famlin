import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser } from './helpers.js';

// A dedicated file (rather than folding these into auth.test.ts) so the
// "no users yet" assertions can rely on this file's own fresh truncation
// (see tests/setup/test-setup.ts) instead of depending on being the first
// test to run within a shared file.
describe('first-run setup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
    // Each test here depends on the exact user count (zero vs. one), and
    // truncation only happens once per file (see tests/setup/test-setup.ts)
    // — so clean up whatever a test created instead of leaking it forward.
    await prisma.user.deleteMany();
  });

  it('reports needsSetup: true when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().needsSetup).toBe(true);
  });

  it('reports needsSetup: false once a user exists', async () => {
    await createUser();

    const res = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().needsSetup).toBe(false);
  });

  it('creates the first admin account and logs it in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'first-admin@example.com', name: 'First Admin', password: 'password1234' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(res.json().user.email).toBe('first-admin@example.com');
    expect(res.json().user.isAdmin).toBe(true);

    const created = await prisma.user.findUnique({ where: { email: 'first-admin@example.com' } });
    expect(created?.isAdmin).toBe(true);
  });

  it('refuses to run setup twice', async () => {
    await createUser({ isAdmin: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'second-admin@example.com', name: 'Second Admin', password: 'password1234' },
    });

    expect(res.statusCode).toBe(409);
    const created = await prisma.user.findUnique({ where: { email: 'second-admin@example.com' } });
    expect(created).toBeNull();
  });
});
