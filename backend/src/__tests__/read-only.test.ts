import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import readOnlyPlugin from '../plugins/readOnly.js';
import { prisma } from '../db.js';

// Unit-test the read-only plugin in isolation so we don't depend on the
// module-load order of config.ts across test files.

async function buildReadOnlyApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await fastify.register(readOnlyPlugin);

  // Dummy routes to verify the allow-list and blocking behavior.
  fastify.post('/api/auth/login', async () => ({ ok: true }));
  fastify.post('/api/auth/oidc', async () => ({ ok: true }));
  fastify.post('/api/auth/oidc/exchange', async () => ({ ok: true }));
  fastify.post('/api/auth/setup', async () => ({ ok: true }));
  fastify.get('/api/auth/server-info', async () => ({ readOnly: true }));
  fastify.post('/api/posts', async () => ({ ok: true }));
  fastify.delete('/api/posts/:id', async () => ({ ok: true }));

  return fastify;
}

let app: FastifyInstance;

beforeAll(async () => {
  process.env.READ_ONLY = 'true';
  app = await buildReadOnlyApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  delete process.env.READ_ONLY;
});

describe('read-only mode', () => {
  it('blocks POST /api/posts', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/posts' });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toContain('read-only');
  });

  it('blocks DELETE /api/posts/:id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/posts/anything' });
    expect(res.statusCode).toBe(403);
  });

  it('blocks PATCH requests', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/posts/anything' });
    expect(res.statusCode).toBe(403);
  });

  it('blocks PUT requests', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/posts/anything' });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /api/auth/server-info', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/server-info' });
    expect(res.statusCode).toBe(200);
    expect(res.json().readOnly).toBe(true);
  });

  it('allows POST /api/auth/login', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /api/auth/oidc', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/oidc' });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /api/auth/oidc/exchange', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/oidc/exchange' });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /api/auth/setup', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup' });
    expect(res.statusCode).toBe(200);
  });
});
