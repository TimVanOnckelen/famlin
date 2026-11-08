import fsp from 'fs/promises'
import path from 'path'
import pg from 'pg'
import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { findUnknownMigrations, readLocalMigrations, runMigrateDeploy } from '../migrationGuard.js'
import { invalidateSettingsCache } from '../settings.js'
import { parseDumpFileName, pgDumpConnection, PgToolNotInstalledError, runPgTool } from './dbDump.js'

// Restores a scheduled-backup dump (`pg_dump -Fc`, see dbDump.ts) over the
// whole database from the first-run setup screen — accounts, passwords and
// settings come back as they were. Only into an instance with zero users,
// and only a dump already sitting in the backups volume's db/ folder: the
// dump's SQL runs verbatim as the database role, so accepting an upload
// would let whoever reaches a fresh server run arbitrary SQL as that role.

export type RestoreDumpErrorCode =
  'unknownDump' | 'invalidDump' | 'dumpTooNew' | 'notEmpty' | 'busy' | 'noPrivilege' | 'restoreFailed' | 'migrateFailed'

export class RestoreDumpError extends Error {
  constructor(
    readonly code: RestoreDumpErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'RestoreDumpError'
  }
}

export interface DumpListing {
  name: string
  size: number
  createdAt: string
}

/** Scheduled-backup dumps in `dir`, newest first (`.partial` and other files ignored). */
export async function listDumps(dir: string): Promise<DumpListing[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const dumps: DumpListing[] = []
  for (const name of names.sort().reverse()) {
    const createdAt = parseDumpFileName(name)
    if (!createdAt) continue
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null)
    if (stat?.isFile()) dumps.push({ name, size: stat.size, createdAt: createdAt.toISOString() })
  }
  return dumps
}

// Every pg_dump custom-format archive starts with these bytes.
const PG_CUSTOM_MAGIC = Buffer.from('PGDMP')

export async function isPgCustomDump(file: string): Promise<boolean> {
  const handle = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(PG_CUSTOM_MAGIC.length)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return bytesRead === buf.length && buf.equals(PG_CUSTOM_MAGIC)
  } finally {
    await handle.close()
  }
}

// Applied migration names from the COPY block pg_restore prints for
// `_prisma_migrations` — the same filter as readAppliedMigrations(): finished
// and not rolled back. `null` when the output has no such table.
export function parseDumpMigrations(sql: string): string[] | null {
  const lines = sql.split('\n')
  const start = lines.findIndex((l) => /^COPY (?:\S+\.)?"?_prisma_migrations"? \(/.test(l))
  if (start === -1) return null
  const columns = lines[start]
    .slice(lines[start].indexOf('(') + 1, lines[start].indexOf(')'))
    .split(',')
    .map((c) => c.trim().replace(/"/g, ''))
  const nameIdx = columns.indexOf('migration_name')
  const finishedIdx = columns.indexOf('finished_at')
  const rolledBackIdx = columns.indexOf('rolled_back_at')
  if (nameIdx === -1) return null

  const names: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line === '\\.') break
    const values = line.split('\t')
    if (values[finishedIdx] === '\\N' || values[rolledBackIdx] !== '\\N') continue
    names.push(values[nameIdx])
  }
  return names
}

// The migrations table is a few KB; anything this big isn't a Famlin dump.
const MAX_MIGRATION_LIST_BYTES = 5 * 1024 * 1024

// Reads the dump's migration history without restoring anything.
async function readDumpMigrations(file: string): Promise<string[] | null> {
  const { password, schema } = pgDumpConnection(config.DATABASE_URL)
  const sql = await runPgTool(
    'pg_restore',
    ['--data-only', '--table=_prisma_migrations', ...(schema ? ['--schema', schema] : []), '-f', '-', file],
    password,
    MAX_MIGRATION_LIST_BYTES
  )
  return parseDumpMigrations(sql)
}

function quotedSchema(): string {
  const { schema } = pgDumpConnection(config.DATABASE_URL)
  return `"${(schema ?? 'public').replace(/"/g, '""')}"`
}

// replaceDatabase() drops the schema in autocommit, so check first that this
// role can recreate it: CREATE on the database, and ownership of the schema
// (directly, via role membership, or as superuser) to drop it.
async function assertCanReplaceSchema(): Promise<void> {
  const { schema } = pgDumpConnection(config.DATABASE_URL)
  const [row] = await prisma.$queryRaw<{ canCreate: boolean; canDrop: boolean | null }[]>`
    SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS "canCreate",
      (SELECT rolsuper OR pg_has_role(current_user, n.nspowner, 'MEMBER')
         FROM pg_roles r, pg_namespace n
        WHERE r.rolname = current_user AND n.nspname = ${schema ?? 'public'}) AS "canDrop"
  `
  // canDrop is null when the schema doesn't exist: nothing to drop.
  if (!row.canCreate || row.canDrop === false) {
    throw new RestoreDumpError('noPrivilege', `canCreate=${row.canCreate} canDrop=${row.canDrop}`)
  }
}

// Empties the schema first: a fresh install's boot already migrated it to
// this version, and tables newer than the dump would collide with the dump's
// own CREATEs and with the pending migrations applied afterwards. That's
// also why pg_restore needs no --clean.
async function replaceDatabase(file: string): Promise<void> {
  const { uri, password, schema } = pgDumpConnection(config.DATABASE_URL)
  const target = quotedSchema()
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${target} CASCADE`)
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${target}`)
  await runPgTool(
    'pg_restore',
    ['--single-transaction', '--no-owner', '--no-privileges', ...(schema ? ['--schema', schema] : []), '-d', uri, file],
    password
  )
}

// A session-level advisory lock on its own connection, held for the whole
// restore however long it takes (an interactive transaction would time out).
// /setup and /setup/restore try the same key and 409 while it's held.
async function acquireSetupLock(lockKey: bigint): Promise<() => Promise<void>> {
  // pg parses the URI itself; only Prisma's `?schema=` would confuse it.
  const url = new URL(config.DATABASE_URL)
  url.searchParams.delete('schema')
  const client = new pg.Client({ connectionString: url.toString() })
  // A dropped connection mid-restore must not crash the process (an
  // unhandled 'error' event would); it only releases the lock early.
  client.on('error', (err) => console.error('setup lock connection lost:', err.message))
  await client.connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      lockKey.toString(),
    ])
    if (!rows[0].locked) throw new RestoreDumpError('busy')
  } catch (err) {
    await client.end()
    throw err
  }
  // Ending the session releases the lock.
  return () => client.end().catch(() => {})
}

// Indirection so tests can stub pg_restore/migrate (CI's Postgres server
// version needn't match the runner's client), like backupDeps.
export const restoreDumpDeps = {
  readDumpMigrations,
  assertCanReplaceSchema,
  replaceDatabase,
  migrateDeploy: runMigrateDeploy,
}

export async function restoreDump(dir: string, name: string, lockKey: bigint): Promise<void> {
  if (!parseDumpFileName(name)) throw new RestoreDumpError('unknownDump', 'Not a dump file name')
  const file = path.join(dir, name)
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat?.isFile()) throw new RestoreDumpError('unknownDump', 'No such dump')
  if (!(await isPgCustomDump(file))) throw new RestoreDumpError('invalidDump')

  let migrations: string[] | null
  try {
    migrations = await restoreDumpDeps.readDumpMigrations(file)
  } catch (err) {
    // A missing pg_restore is this server's problem, not the file's.
    if (err instanceof PgToolNotInstalledError) throw new RestoreDumpError('restoreFailed', err.message)
    throw new RestoreDumpError('invalidDump', (err as Error).message)
  }
  if (!migrations || migrations.length === 0) throw new RestoreDumpError('invalidDump', 'No Famlin migrations')
  const unknown = findUnknownMigrations(migrations, await readLocalMigrations())
  if (unknown.length > 0) throw new RestoreDumpError('dumpTooNew', unknown.join(', '))

  const release = await acquireSetupLock(lockKey)
  let touched = false
  try {
    // Authoritative: /setup can't create an account while the lock is held.
    if ((await prisma.user.count()) > 0) throw new RestoreDumpError('notEmpty')
    await restoreDumpDeps.assertCanReplaceSchema()

    touched = true
    try {
      await restoreDumpDeps.replaceDatabase(file)
    } catch (err) {
      // The schema may now be empty: migrate it back to a usable fresh
      // install before reporting the failure.
      await restoreDumpDeps.migrateDeploy().catch(() => {})
      throw new RestoreDumpError('restoreFailed', (err as Error).message)
    }
    // Sessions issued before the dump was taken would otherwise work again.
    await prisma.$executeRawUnsafe(`UPDATE ${quotedSchema()}."User" SET "tokenVersion" = "tokenVersion" + 1`)
    // A dump from an older version: bring it up to this one.
    try {
      await restoreDumpDeps.migrateDeploy()
    } catch (err) {
      throw new RestoreDumpError('migrateFailed', (err as Error).message)
    }
  } finally {
    if (touched) invalidateSettingsCache()
    await release()
  }
}
