import crypto from 'crypto';
import type { sanitizeUser } from './users.js';

// The mobile OIDC callback (GET /oidc/mobile-callback) can't hand the Famlin
// session token back to the app via the famlin:// redirect's query string
// without it ending up in the server's own access logs and browser history.
// Instead it mints a short-lived, single-use code, redirects the app to
// famlin://oidc-callback?handoff=<code>, and the app immediately exchanges
// that code for the real token over POST /oidc/mobile-handoff. In-memory and
// single-instance, matching the other short-lived caches in this codebase
// (discoveryCache, sessionCache) — Famlin doesn't run multiple backend
// replicas behind a shared store.
const HANDOFF_TTL_MS = 2 * 60 * 1000;

interface HandoffEntry {
  token: string;
  user: ReturnType<typeof sanitizeUser>;
  expiresAt: number;
}

const handoffs = new Map<string, HandoffEntry>();

function sweepExpired() {
  const now = Date.now();
  for (const [code, entry] of handoffs) {
    if (entry.expiresAt < now) handoffs.delete(code);
  }
}

export function createOidcHandoff(result: { token: string; user: HandoffEntry['user'] }): string {
  sweepExpired();
  const code = crypto.randomBytes(32).toString('base64url');
  handoffs.set(code, { ...result, expiresAt: Date.now() + HANDOFF_TTL_MS });
  return code;
}

export function consumeOidcHandoff(code: string): { token: string; user: HandoffEntry['user'] } | null {
  const entry = handoffs.get(code);
  handoffs.delete(code); // single-use regardless of outcome
  if (!entry || entry.expiresAt < Date.now()) return null;
  return { token: entry.token, user: entry.user };
}
