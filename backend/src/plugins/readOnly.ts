import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getT } from '../i18n/index.js';

// HTTP methods that write or delete data. OPTIONS is deliberately excluded —
// @fastify/cors handles CORS preflight before this hook runs.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Endpoints that must stay writable in read-only mode so visitors can still
// sign in and browse. All other POST/PUT/PATCH/DELETE requests are rejected.
const ALLOWED_MUTATING_PREFIXES = [
  '/api/auth/login',
  '/api/auth/oidc',
  '/api/auth/setup',
];

function isAllowedMutatingRequest(url: string): boolean {
  return ALLOWED_MUTATING_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`));
}

/**
 * When READ_ONLY=true, rejects every mutating request with 403, except for a
 * short allow-list of authentication/session endpoints. This lets a demo
 * instance serve public read access without risk of abuse via posts,
 * comments, uploads, admin changes, etc.
 */
export default fp(async function readOnlyPlugin(fastify: FastifyInstance) {
  if (process.env.READ_ONLY !== 'true') return;

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;

    const url = request.raw.url ?? '';
    if (isAllowedMutatingRequest(url)) return;

    const t = getT(request);
    return reply.status(403).send({ error: t('errors.readOnly') });
  });

  fastify.log.info('Read-only mode enabled: mutating requests are blocked');
});
