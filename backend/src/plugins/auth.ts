import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getOidcSettings, isEmailAllowed } from '../services/settings.js';
import { API_TOKEN_PREFIX, verifyApiToken } from '../services/apiTokens.js';
import { isGroupMember } from '../services/groups.js';
import { getT } from '../i18n/index.js';

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
    // How this request authenticated: an interactive login session (JWT) or a
    // developer personal access token. Routes that mint new credentials
    // (routes/api-tokens.ts) require 'session' so a leaked PAT can't be used
    // to create replacement PATs and outlive its own revocation.
    authMethod?: 'session' | 'api-token';
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
  constructor(public code: 'not_configured' | 'no_email' | 'not_allowed' | 'exchange_failed') {
    super(code);
    this.name = 'OidcError';
  }
}

// Server-mediated authorization code exchange for providers (e.g. Google)
// that reject a secretless PKCE exchange from a public client — see
// oidcClientSecret in services/settings.ts. Unlike the client-side PKCE flow,
// the secret itself is proof of client identity, so codeVerifier is optional
// here (still passed through when the caller generated one, for defense in
// depth, but its absence isn't a problem).
export async function exchangeOidcCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<string> {
  const { issuer, clientId, clientSecret } = await getOidcSettings();
  if (!issuer || !clientId || !clientSecret) {
    throw new OidcError('not_configured');
  }

  const { doc } = await getDiscovery(issuer);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (params.codeVerifier) {
    body.set('code_verifier', params.codeVerifier);
  }

  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!res.ok || !data?.id_token) {
    throw new OidcError('exchange_failed');
  }
  return data.id_token;
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
// session credential to proxy/CDN logs. Carries the user's tokenVersion so a
// password reset / account deletion can invalidate it the same way it
// invalidates a session token (see isSessionCurrent).
export function createMediaToken(userId: string, tokenVersion: number) {
  return jwt.sign({ id: userId, scope: 'media', tokenVersion }, config.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyMediaToken(token: string): { id: string; tokenVersion?: number } | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { id?: string; scope?: string; tokenVersion?: number };
    if (decoded.scope !== 'media' || !decoded.id) return null;
    return { id: decoded.id, tokenVersion: decoded.tokenVersion };
  } catch {
    return null;
  }
}

// /uploads is hit once per photo/video rendered (dozens per feed screen), far
// more often than any other authenticated route, so isSessionCurrent's DB
// lookup is cached briefly per user. Explicitly invalidated by every route
// that changes tokenVersion (see invalidateSessionCache calls in
// routes/auth.ts and routes/admin.ts) so revocation still takes effect
// immediately in the normal case; the TTL only bounds staleness if a call
// site is ever missed.
const SESSION_CACHE_TTL_MS = 5_000;
const sessionCache = new Map<string, { tokenVersion: number; expiresAt: number }>();

export function invalidateSessionCache(userId: string) {
  sessionCache.delete(userId);
}

// Confirms a decoded token still corresponds to an existing user at its
// issued tokenVersion — the DB check that `verifyToken`/`verifyMediaToken`
// (signature + expiry only) can't do on their own. Used by the /uploads auth
// hook so a deleted user or a token from before a password reset loses media
// access immediately, matching the guarantee the main `authenticate`
// decorator makes.
export async function isSessionCurrent(decoded: { id: string; tokenVersion?: number }): Promise<boolean> {
  const cached = sessionCache.get(decoded.id);
  const now = Date.now();
  let user: { tokenVersion: number };

  if (cached && cached.expiresAt > now) {
    user = cached;
  } else {
    const found = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { tokenVersion: true },
    });
    if (!found) {
      sessionCache.delete(decoded.id);
      return false;
    }
    user = found;
    sessionCache.set(decoded.id, { ...found, expiresAt: now + SESSION_CACHE_TTL_MS });
  }

  if (decoded.tokenVersion !== undefined && user.tokenVersion !== decoded.tokenVersion) return false;
  return true;
}

// Shared by anything gated the same way /uploads/* is: accepts either a
// normal session token (header) or a scoped media token (query string, for
// <Image>/<Video> sources that can't send custom headers) — see
// routes/uploads.ts and routes/immich.ts. Returns the authenticated user id,
// or null if neither form of auth checks out.
export async function authenticateMediaRequest(request: FastifyRequest): Promise<string | null> {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7);
    if (bearer.startsWith(API_TOKEN_PREFIX)) {
      // Developer personal access tokens can read media too — verifyApiToken
      // already checks existence (revocation) and expiry against the DB.
      const user = await verifyApiToken(bearer);
      if (user) return user.id;
    } else {
      try {
        const decoded = verifyToken(bearer);
        if (await isSessionCurrent(decoded)) return decoded.id;
      } catch {
        // fall through to the media-token check below
      }
    }
  }

  const queryToken = (request.query as { token?: string } | undefined)?.token;
  if (queryToken) {
    const decoded = verifyMediaToken(queryToken);
    if (decoded && (await isSessionCurrent(decoded))) return decoded.id;
  }

  return null;
}

// Returns true (and sends a 403) when the caller is not an admin. Callers MUST
// `return` when this returns true, otherwise the handler keeps executing after
// the 403 is sent and the mutation still runs.
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.user?.isAdmin) {
    reply.status(403).send({ error: getT(request)('errors.adminRequired') });
    return true;
  }
  return false;
}

// Returns true (and sends a 403) when the caller isn't a member of groupId.
// Same contract as requireAdmin: callers MUST `return` when this returns true.
export async function requireGroupMember(request: FastifyRequest, reply: FastifyReply, groupId: string): Promise<boolean> {
  if (!(await isGroupMember(groupId, request.user!.id))) {
    reply.status(403).send({ error: getT(request)('errors.notGroupMember') });
    return true;
  }
  return false;
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.slice(7);

      // Developer personal access token — the DB row is the credential
      // (existence = valid, deletion = revoked), so unlike a JWT there is no
      // signature or tokenVersion to check.
      if (token.startsWith(API_TOKEN_PREFIX)) {
        const user = await verifyApiToken(token);
        if (!user) {
          return reply.status(401).send({ error: 'Unauthorized' });
        }
        request.user = user;
        request.authMethod = 'api-token';
        return;
      }

      const decoded = verifyToken(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, isAdmin: true, tokenVersion: true },
      });

      if (!user) {
        return reply.status(401).send({ error: 'User not found' });
      }

      // Lets a password change/reset or an admin-forced sign-out invalidate
      // every token issued before it, without needing a token blocklist.
      if (user.tokenVersion !== decoded.tokenVersion) {
        return reply.status(401).send({ error: 'Session expired' });
      }

      const { tokenVersion, ...publicUser } = user;
      request.user = publicUser;
      request.authMethod = 'session';
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
};

export default fp(authPlugin);
