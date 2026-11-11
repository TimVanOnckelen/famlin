import { createHash, randomBytes } from 'crypto'
import { prisma } from '../db.js'

// Personal access tokens for developers calling the API from their own
// scripts/integrations. The plaintext is `famlin_pat_<base64url secret>` and
// is returned exactly once at creation — only its SHA-256 hash is stored, so
// a database leak doesn't leak usable credentials. A PAT authenticates as
// the user who created it (same request.user shape as a session token), so
// every route's group-membership authorization applies to it unchanged.
export const API_TOKEN_PREFIX = 'famlin_pat_'

// lastUsedAt is informational ("is this token still in use?"), so it's
// written at most this often per token instead of on every request.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApiToken() {
  const secret = randomBytes(32).toString('base64url')
  const token = `${API_TOKEN_PREFIX}${secret}`
  return {
    token,
    tokenHash: hashToken(token),
    tokenPreview: secret.slice(0, 8),
  }
}

// Resolves a presented PAT to its owning user, or null when the token is
// unknown, expired, or revoked (deleted). No tokenVersion check on purpose:
// a password reset invalidates sessions but deliberately keeps a developer's
// integrations running — revoking a PAT is deleting its row.
//
// `isAdmin` on the returned user is the token's effective right, not the
// owner's: it is true only when the owner is an admin AND the token was
// created with adminAccess. Every admin check in the app reads
// request.user.isAdmin, so a token without it is an ordinary member
// everywhere — /api/admin and the moderation paths in member routes alike.
export async function verifyApiToken(token: string) {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isAdmin: true } } },
  })
  if (!record) return null
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null

  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Fire-and-forget: tracking usage must never fail or slow down the request.
    prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return { ...record.user, isAdmin: record.user.isAdmin && record.adminAccess }
}
