import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Zero-config startup (issue #338): fills in the two secrets a fresh install
// would otherwise need an .env for. Runs from config.ts *before* the zod
// validation, so an explicit environment variable always wins and the rest of
// the app only ever sees the resolved values.
//
// This module deliberately imports nothing from the app (no config, no db):
// config.ts imports it, and it must work before any of them are loadable.

type Env = Record<string, string | undefined>

export const JWT_SECRET_FILE = path.join('secrets', 'jwt_secret')

export function resolveDataDir(env: Env = process.env, cwd: string = process.cwd()): string {
  return path.resolve(env.DATA_DIR || path.join(cwd, 'data'))
}

/**
 * JWT signing secret: the JWT_SECRET env var if set, otherwise a random secret
 * generated on first boot and persisted (mode 0600) to
 * `<dataDir>/secrets/jwt_secret`, then reused on every later boot. The value is
 * never logged. Losing the file only invalidates existing sessions.
 */
export function resolveJwtSecret(
  env: Env,
  dataDir: string,
  log: (message: string) => void = (m) => console.info(m)
): string {
  if (env.JWT_SECRET) return env.JWT_SECRET

  const file = path.join(dataDir, JWT_SECRET_FILE)
  const existing = readSecretFile(file)
  if (existing) return existing

  const secret = crypto.randomBytes(48).toString('base64url')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    // 'wx': never overwrite — if another process won the race, use its secret.
    fs.writeFileSync(file, secret, { mode: 0o600, flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // The winner creates the file before writing it, so it may still be empty.
      for (let attempt = 0; attempt < 5; attempt++) {
        const raced = readSecretFile(file)
        if (raced) return raced
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      }
      const raced = readSecretFile(file)
      if (raced) return raced
    }
    const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message
    throw new Error(
      `Cannot write the generated JWT secret to ${file} (${reason}): set JWT_SECRET or make DATA_DIR (${dataDir}) writable`,
      { cause: err }
    )
  }
  log(`JWT_SECRET is not set: generated a new secret and stored it at ${file}`)
  return secret
}

function readSecretFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw err
  }
}

/**
 * Builds DATABASE_URL from POSTGRES_HOST/PORT/USER/DB and a password taken from
 * POSTGRES_PASSWORD or the file named by POSTGRES_PASSWORD_FILE (URL-encoded).
 * Returns undefined when no password is available, leaving DATABASE_URL unset
 * so validation reports it.
 */
export function deriveDatabaseUrl(env: Env): string | undefined {
  let password = env.POSTGRES_PASSWORD
  if (!password && env.POSTGRES_PASSWORD_FILE) {
    password = fs.readFileSync(env.POSTGRES_PASSWORD_FILE, 'utf8').trim()
  }
  if (!password) return undefined
  const host = env.POSTGRES_HOST || 'famlin-db'
  const port = env.POSTGRES_PORT || '5432'
  const user = env.POSTGRES_USER || 'famlin'
  const db = env.POSTGRES_DB || 'famlin'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}?schema=public`
}

/**
 * Mutates `env` (process.env by default) so JWT_SECRET and DATABASE_URL are set
 * if they can be derived. Setting process.env.DATABASE_URL also means child
 * processes (boot.ts's `prisma migrate deploy`) inherit it.
 */
export function applyBootstrapEnv(env: Env = process.env): void {
  if (!env.DATABASE_URL) {
    const url = deriveDatabaseUrl(env)
    if (url) env.DATABASE_URL = url
    else delete env.DATABASE_URL
  }
  env.JWT_SECRET = resolveJwtSecret(env, resolveDataDir(env))
}
