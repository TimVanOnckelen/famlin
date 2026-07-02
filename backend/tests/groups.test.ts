import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, createGroupWithMember, authHeader } from './helpers.js';

describe('groups routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only the groups the caller belongs to', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const myGroup = await createGroupWithMember(member);
    await createGroupWithMember(outsider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: authHeader(member),
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(myGroup.id);
  });

  it('rejects a non-member reading group detail', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(member);

    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}`,
      headers: authHeader(outsider),
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects a non-member reading the member list', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroupWithMember(member);

    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(outsider),
    });

    expect(res.statusCode).toBe(403);
  });

  it('lets a member read the member list', async () => {
    const member = await createUser();
    const group = await createGroupWithMember(member);

    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(member),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/groups' });
    expect(res.statusCode).toBe(401);
  });

  // groups.ts is documented as deliberately read-only — group/member
  // mutations must only exist under /api/admin. A regression that re-adds a
  // mutating route here would silently reopen it to any authenticated user
  // (no requireAdmin guard exists in this file), so guard against that shape
  // of route ever coming back.
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)('has no %s route registered under /api/groups', async (method) => {
    const user = await createUser();
    const group = await createGroupWithMember(user);

    const res = await app.inject({
      method,
      url: `/api/groups/${group.id}`,
      headers: authHeader(user),
    });

    expect(res.statusCode).toBe(404);
  });
});
