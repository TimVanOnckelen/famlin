import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp } from './helpers.js';

// /health is what the container healthcheck (docker-compose.yml) polls, so it
// has to reflect whether the server can actually serve requests — and, being
// public, must not say which dependency is down.
describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns 200 when the database and uploads directory are usable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 without details when the database is unreachable', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error' });
    expect(res.body).not.toContain('ECONNREFUSED');

    const recovered = await app.inject({ method: 'GET', url: '/health' });
    expect(recovered.statusCode).toBe(200);
  });

  it('is not rate limited', async () => {
    // Control: other routes carry the rate-limit header, so its absence below
    // means /health is exempt rather than that the header never exists.
    const other = await app.inject({ method: 'GET', url: '/api/auth/setup-status' });
    expect(other.headers['x-ratelimit-limit']).toBeDefined();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
