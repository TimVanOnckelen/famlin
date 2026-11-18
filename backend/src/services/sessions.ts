import { prisma } from '../db.js'

// Server-side sessions (see the Session model in schema.prisma). A session
// JWT carries its row id as `sid`; the row is the part the server can revoke.

// Same lifetime the session JWT has always had.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Keeps the device list readable and bounds the table if a client signs in in
// a loop: beyond this, the least recently used sessions are dropped.
const MAX_SESSIONS_PER_USER = 50

// lastUsedAt is informational ("is this device still in use?"), so it is
// written at most this often per session instead of on every request.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000

const USER_AGENT_MAX_LENGTH = 255

export async function createSession(userId: string, userAgent: string | undefined) {
  const now = new Date()
  // Prune this user's expired sessions on every sign-in, so the table never
  // needs a job of its own.
  await prisma.session.deleteMany({ where: { userId, expiresAt: { lte: now } } })

  const session = await prisma.session.create({
    data: {
      userId,
      userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  })

  const surplus = await prisma.session.findMany({
    where: { userId },
    orderBy: { lastUsedAt: 'desc' },
    skip: MAX_SESSIONS_PER_USER,
    select: { id: true },
  })
  if (surplus.length > 0) await revokeSessions({ id: { in: surplus.map((s) => s.id) } })

  return session
}

export function touchSession(session: { id: string; lastUsedAt: Date }) {
  if (Date.now() - session.lastUsedAt.getTime() <= LAST_USED_WRITE_INTERVAL_MS) return
  // Fire-and-forget: tracking usage must never fail or slow down the request.
  prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Liveness cache for media requests. /uploads is hit once per photo rendered,
// so the media-token check caches "does this session still exist" briefly —
// the same trade-off isSessionCurrent makes for tokenVersion. Every revocation
// below invalidates it, so the TTL only bounds staleness for a missed path.
// ---------------------------------------------------------------------------
const LIVENESS_TTL_MS = 5_000
const liveness = new Map<string, { userId: string; alive: boolean; expiresAt: number }>()

export async function isSessionAlive(sessionId: string, userId: string): Promise<boolean> {
  const now = Date.now()
  const cached = liveness.get(sessionId)
  if (cached && cached.expiresAt > now) return cached.alive && cached.userId === userId

  const row = await prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, expiresAt: true } })
  const alive = !!row && row.expiresAt.getTime() > now
  liveness.set(sessionId, { userId: row?.userId ?? userId, alive, expiresAt: now + LIVENESS_TTL_MS })
  return alive && row!.userId === userId
}

export function clearSessionLivenessCache() {
  liveness.clear()
}

/** Deletes the matching sessions; returns how many were removed. */
export async function revokeSessions(where: { id?: string | { in: string[] }; userId?: string; NOT?: { id: string } }) {
  const doomed = await prisma.session.findMany({ where, select: { id: true } })
  if (doomed.length === 0) return 0
  const { count } = await prisma.session.deleteMany({ where: { id: { in: doomed.map((s) => s.id) } } })
  for (const { id } of doomed) liveness.delete(id)
  return count
}

/** Every session of a user — after a password change/reset or a forced sign-out. */
export function revokeAllSessionsOfUser(userId: string) {
  return revokeSessions({ userId })
}
