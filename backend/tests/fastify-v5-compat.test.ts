import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js';

// Pins the two Fastify 4 -> 5 behaviour changes that clients would have felt,
// neither of which any other test covers: both are about how a request reaches
// the server, not about what a handler does with it.
//
// They matter more than a normal regression because Famlin ships a pre-built
// mobile app that many deployments run unchanged — a server-side break here
// can't be fixed by shipping new client code.
describe('Fastify 5 client compatibility', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Fastify 5 parses a body for every body-carrying method, where 4 skipped
  // parsing when the request had none; its JSON parser then rejects an empty
  // body with FST_ERR_CTP_EMPTY_JSON_BODY (400). axios sets Content-Type on
  // every request from its instance defaults (packages/api-client's client.ts)
  // and sends no body on DELETE, so without the onRequest hook in app.ts every
  // DELETE from every client 400s before its handler runs.
  describe('bodyless request carrying a JSON Content-Type', () => {
    it('lets an authenticated DELETE through to its handler', async () => {
      const user = await createUser();
      const group = await createGroupWithMember(user);
      const post = await createPost({ groupId: group.id, authorId: user.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/posts/${post.id}`,
        headers: { ...authHeader(user), 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    });

    it('also accepts an explicit Content-Length: 0', async () => {
      const user = await createUser();
      const group = await createGroupWithMember(user);
      const post = await createPost({ groupId: group.id, authorId: user.id });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/posts/${post.id}`,
        headers: { ...authHeader(user), 'content-type': 'application/json', 'content-length': '0' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('reaches the auth guard, not the body parser, when unauthenticated', async () => {
      // The distinction that matters: 401 means the request got as far as the
      // route's auth preHandler; 400 would mean it died in body parsing.
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/posts/some-id',
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('still rejects a malformed body, so the JSON parser is untouched', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '{"email": ',
      });

      expect(res.statusCode).toBe(400);
    });

    it('still parses a well-formed body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });

      // 401, not the 400 an unparsed/absent body would produce: the handler
      // saw both fields and got as far as looking the account up.
      expect(res.statusCode).toBe(401);
    });
  });

  // Fastify 5 redefined request.hostname to exclude the port and introduced
  // request.host as the port-carrying property (in 4, hostname carried it).
  // Every origin Famlin hands to a client has to survive a deployment that
  // isn't on 80/443 — a dropped port yields invite links that don't resolve
  // and an OIDC redirect_uri that no longer matches what was registered.
  describe('origins built from the incoming request', () => {
    it('keeps the port in an admin-generated invite link', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/invites`,
        headers: { ...authHeader(admin), host: 'famlin.example:8443' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().link).toContain('://famlin.example:8443/invite/');
    });

    it('keeps the port in the invite landing page handoff link', async () => {
      const group = await createGroupWithMember(await createUser());
      const invite = await prisma.invite.create({
        data: { token: `token-${Math.random().toString(36).slice(2)}`, groupId: group.id },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/invite/${invite.token}`,
        headers: { host: 'famlin.example:8443' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(encodeURIComponent('famlin.example:8443'));
    });

    it('omits nothing when the deployment is on a default port', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${group.id}/invites`,
        headers: { ...authHeader(admin), host: 'famlin.example' },
        payload: {},
      });

      expect(res.json().link).toContain('://famlin.example/invite/');
    });
  });
});
