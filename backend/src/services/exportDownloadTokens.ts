import crypto from 'crypto'
import { prisma } from '../db.js'

// GET /api/admin/export is downloaded by a plain browser navigation (so the
// browser streams a multi-GB zip straight to disk with its own progress UI)
// — which can't carry the admin's Authorization header. The admin UI first
// mints one of these over an authenticated POST /api/admin/export/token and
// puts it in the download URL instead. Short-lived and single-use, so the
// token leaking into an access log or browser history is harmless; same
// in-memory, single-instance shape as services/oidcHandoff.ts.
const DOWNLOAD_TOKEN_TTL_MS = 60 * 1000

interface DownloadTokenEntry {
  userId: string
  tokenVersion: number
  expiresAt: number
}

const downloadTokens = new Map<string, DownloadTokenEntry>()

function sweepExpired() {
  const now = Date.now()
  for (const [token, entry] of downloadTokens) {
    if (entry.expiresAt < now) downloadTokens.delete(token)
  }
}

export async function createExportDownloadToken(userId: string): Promise<string> {
  sweepExpired()
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } })
  const token = crypto.randomBytes(32).toString('base64url')
  downloadTokens.set(token, { userId, tokenVersion: user.tokenVersion, expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS })
  return token
}

// Returns the token's user as it is *now* (so a demotion or sign-out since
// the token was issued counts), or null for an unknown, used or expired
// token. The caller still checks isAdmin.
export async function redeemExportDownloadToken(token: string) {
  const entry = downloadTokens.get(token)
  downloadTokens.delete(token) // single-use regardless of outcome
  if (!entry || entry.expiresAt < Date.now()) return null
  const user = await prisma.user.findUnique({
    where: { id: entry.userId },
    select: { id: true, email: true, name: true, isAdmin: true, tokenVersion: true },
  })
  if (!user || user.tokenVersion !== entry.tokenVersion) return null
  const { tokenVersion: _tokenVersion, ...publicUser } = user
  return publicUser
}
