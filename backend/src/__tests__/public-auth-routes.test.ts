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
    // Both store URLs default to the official pre-built apps when the setting
    // has never been saved; an admin can still clear either one to null.
    expect(body.appStoreUrl).toBe('https://apps.apple.com/us/app/famlin/id6786783660');
    expect(body.playStoreUrl).toBe('https://play.google.com/store/apps/details?id=be.xeweb.famlin');
  });
});
