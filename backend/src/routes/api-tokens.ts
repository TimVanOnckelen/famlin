import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { getT } from '../i18n/index.js';
import { generateApiToken } from '../services/apiTokens.js';
import { createApiTokenBodySchema } from '../types.js';

// Self-service developer personal access tokens (PATs) — lets a member call
// the API from their own scripts/integrations. A PAT authenticates as its
// owner, so everything it can see is bounded by the same group-membership
// rule as the apps. Management is per-user: you only ever see and revoke
// your own tokens.
export default async function apiTokenRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const items = await prisma.apiToken.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, tokenPreview: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
    return { items };
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // Only an interactive login session may mint a PAT — otherwise a leaked
    // token could create replacements for itself and survive revocation.
    if (request.authMethod !== 'session') {
      return reply.status(403).send({ error: getT(request)('errors.apiTokenSessionRequired') });
    }

    const body = createApiTokenBodySchema.parse(request.body);
    const { token, tokenHash, tokenPreview } = generateApiToken();

    const created = await prisma.apiToken.create({
      data: {
        userId: request.user!.id,
        name: body.name,
        tokenHash,
        tokenPreview,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000) : null,
      },
    });

    // The only response that ever contains the plaintext token.
    return reply.status(201).send({
      id: created.id,
      name: created.name,
      token,
      tokenPreview: created.tokenPreview,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    });
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Scoped to the caller's own tokens — deleteMany + count instead of a
    // findUnique/ownership-check pair, so someone else's token id 404s the
    // same way a nonexistent one does.
    const result = await prisma.apiToken.deleteMany({
      where: { id, userId: request.user!.id },
    });
    if (result.count === 0) {
      return reply.status(404).send({ error: getT(request)('errors.apiTokenNotFound') });
    }

    return { success: true };
  });
}
