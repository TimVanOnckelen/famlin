import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

// Covers the public, unauthenticated GET /api/auth/server-info route —
// mobile's update-required gate and the profile screen depend on its shape.

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/auth/server-info', () => {
  it('returns the app version, minAppVersion, store links, and read-only flag without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/server-info' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.version).toBe('string');
    expect(typeof body.minAppVersion).toBe('string');
    expect(body).toHaveProperty('appStoreUrl');
    expect(body).toHaveProperty('playStoreUrl');
    expect(body).toHaveProperty('readOnly');
    expect(typeof body.readOnly).toBe('boolean');
    // appStoreUrl has no default (no single iOS listing) — null when unset.
    expect(body.appStoreUrl === null || typeof body.appStoreUrl === 'string').toBe(true);
    // playStoreUrl defaults to the official pre-built Android app.
    expect(body.playStoreUrl === null || typeof body.playStoreUrl === 'string').toBe(true);
  });
});
