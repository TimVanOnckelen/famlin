import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getOidcSettings, isEmailAllowed } from '../services/settings.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedRequest['user'];
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface DiscoveryDocument {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

// Discovery documents and their JWKS keysets rarely change, so cache them
// per issuer instead of re-fetching on every login.
const discoveryCache = new Map<string, { doc: DiscoveryDocument; jwks: ReturnType<typeof createRemoteJWKSet> }>();

export async function getDiscovery(issuer: string) {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) {
    throw new Error('Could not reach the OIDC provider');
  }
  const doc = (await res.json()) as DiscoveryDocument;
  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));

  const entry = { doc, jwks };
  discoveryCache.set(issuer, entry);
  return entry;
}

// Thrown for expected, user-facing OIDC failures so routes can map them to a
// translated message instead of leaking jose/fetch internals via err.message.
export class OidcError extends Error {
  constructor(public code: 'not_configured' | 'no_email' | 'not_allowed') {
    super(code);
    this.name = 'OidcError';
  }
}

export async function verifyOidcToken(idToken: string, options?: { allowUnlisted?: boolean }) {
  const { issuer, clientId } = await getOidcSettings();

  if (!issuer || !clientId) {
    throw new OidcError('not_configured');
  }

  const { doc, jwks } = await getDiscovery(issuer);

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: doc.issuer,
    audience: clientId,
  });

  const email = (payload.email as string | undefined)?.toLowerCase();
  if (!email) {
    throw new OidcError('no_email');
  }

  // A valid invite is its own authorization, so it can provision an account
  // for an email that isn't on the allowedEmails whitelist.
  if (!options?.allowUnlisted && !(await isEmailAllowed(email))) {
    throw new OidcError('not_allowed');
  }

  return {
    email,
    name: (payload.name as string | undefined) || email.split('@')[0],
    picture: payload.picture as string | undefined,
  };
}

export function createUserToken(user: { id: string; email: string; name: string; isAdmin: boolean; tokenVersion: number }) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, tokenVersion: user.tokenVersion },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function verifyToken(token: string) {
  return jwt.verify(token, config.JWT_SECRET) as AuthenticatedRequest['user'] & { tokenVersion: number };
}

// A narrow-scope, longer-lived token used only to authorize reading files
// under /uploads — issued separately from the main session token so it can
// be embedded in image/video URLs (query string) without exposing the full
// session credential to proxy/CDN logs.
export function createMediaToken(userId: string) {
  return jwt.sign({ id: userId, scope: 'media' }, config.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyMediaToken(token: string): boolean {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { scope?: string };
    return decoded.scope === 'media';
  } catch {
    return false;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.slice(7);
      const decoded = verifyToken(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, isAdmin: true, tokenVersion: true, deletedAt: true },
      });

      if (!user || user.deletedAt) {
        return reply.status(401).send({ error: 'User not found' });
      }

      // Lets a password change/reset or an admin-forced sign-out invalidate
      // every token issued before it, without needing a token blocklist.
      if (user.tokenVersion !== decoded.tokenVersion) {
        return reply.status(401).send({ error: 'Session expired' });
      }

      const { tokenVersion, deletedAt, ...publicUser } = user;
      request.user = publicUser;
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
};

export default fp(authPlugin);
