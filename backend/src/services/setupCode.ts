import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { dataDir } from '../config.js'

// One-time setup code (security hardening): the first-run routes —
// POST /api/auth/setup and the /setup/* restore routes — used to be
// authorized by "the database has zero users" alone, so whoever reached a
// freshly started server first (it is often on the internet before its owner
// opens /admin, e.g. behind the installer's Caddy or a Cloudflare tunnel)
// could make themselves its admin, or restore a crafted backup full of their
// own accounts. They now also require this code, which only someone who can
// read the server's log or its data volume knows.
//
// Generated on first need, persisted (mode 0600) next to the generated JWT
// secret so it survives restarts and can be read back with
// `docker compose exec famlin-backend cat /app/data/secrets/setup_code`, and
// deleted once setup has succeeded.
export const SETUP_CODE_FILE = path.join('secrets', 'setup_code')

// The header every first-run route reads the code from (JSON, multipart and
// GET requests alike).
export const SETUP_CODE_HEADER = 'x-setup-code'

// No 0/O/1/I: the code is typed in by hand from a log line.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function setupCodePath() {
  return path.join(dataDir, SETUP_CODE_FILE)
}

// 12 characters of a 32-letter alphabet = 60 bits, against routes limited to
// a handful of attempts per 15 minutes per IP.
function generateCode(): string {
  const bytes = crypto.randomBytes(12)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

function readCode(): string | null {
  try {
    return fs.readFileSync(setupCodePath(), 'utf8').trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  }
}

/**
 * The current setup code, generating and persisting one when none exists.
 * `onGenerated` is told when a new code was created, so the caller can log it.
 */
export function getSetupCode(onGenerated?: (code: string, file: string) => void): string {
  const existing = readCode()
  if (existing) return existing

  const code = generateCode()
  const file = setupCodePath()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try {
    // 'wx': never overwrite a code another process already wrote.
    fs.writeFileSync(file, code, { mode: 0o600, flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readCode() ?? code
    throw err
  }
  onGenerated?.(code, file)
  return code
}

// Case, spaces and dashes don't matter: people retype it from a log.
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** Constant-time check of a code a client sent against the current one. */
export function isValidSetupCode(provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || provided.length > 64) return false
  const expected = getSetupCode()
  const a = crypto.createHash('sha256').update(normalize(provided)).digest()
  const b = crypto.createHash('sha256').update(normalize(expected)).digest()
  return crypto.timingSafeEqual(a, b)
}

/** Called once the instance has its first users: the code has done its job. */
export function clearSetupCode() {
  try {
    fs.rmSync(setupCodePath(), { force: true })
  } catch {
    // Best effort — a leftover code is harmless once users exist, since every
    // route it unlocks also requires an empty instance.
  }
}
