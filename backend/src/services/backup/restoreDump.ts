import { spawn } from 'child_process'
import fsp from 'fs/promises'
import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { findUnknownMigrations, readLocalMigrations, runMigrateDeploy } from '../migrationGuard.js'
import { invalidateSettingsCache } from '../settings.js'
import { pgDumpConnection } from './dbDump.js'

// Restores a scheduled-backup dump (`pg_dump -Fc`, see dbDump.ts) uploaded on
// the first-run setup screen — the whole database, so accounts, passwords
// and settings come back as they were. Only into an instance with zero users.

export type RestoreDumpErrorCode = 'invalidDump' | 'dumpTooNew' | 'notEmpty' | 'restoreFailed'

export class RestoreDumpError extends Error {
  constructor(
    readonly code: RestoreDumpErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'RestoreDumpError'
  }
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
    if (finishedIdx !== -1 && values[finishedIdx] === '\\N') continue
    if (rolledBackIdx !== -1 && values[rolledBackIdx] !== '\\N') continue
    names.push(values[nameIdx])
  }
  return names
}

function runPgRestore(args: string[], password: string, captureStdout: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_restore', args, {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString()
    })
    child.on('error', (err) => {
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('pg_restore is not installed in this container')
          : err
      )
    })
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `pg_restore exited with code ${code}`))
    })
  })
}

// Reads the dump's migration history without restoring anything.
async function readDumpMigrations(file: string): Promise<string[] | null> {
  const { password, schema } = pgDumpConnection(config.DATABASE_URL)
  const sql = await runPgRestore(
    ['--data-only', '--table=_prisma_migrations', ...(schema ? ['--schema', schema] : []), '-f', '-', file],
    password,
    true
  )
  return parseDumpMigrations(sql)
}

// Empties the schema first: a fresh install's boot already migrated it to
// this version, and tables newer than the dump would otherwise survive
// `--clean` (block its DROPs through foreign keys) and collide with the
// pending migrations applied afterwards.
async function replaceDatabase(file: string): Promise<void> {
  const { uri, password, schema } = pgDumpConnection(config.DATABASE_URL)
  const target = (schema ?? 'public').replace(/"/g, '""')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${target}" CASCADE`)
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${target}"`)
  await runPgRestore(
    [
      '--clean',
      '--if-exists',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      ...(schema ? ['--schema', schema] : []),
      '-d',
      uri,
      file,
    ],
    password,
    false
  )
}

async function migrateDeploy(): Promise<void> {
  const status = await runMigrateDeploy()
  if (status !== 0) throw new Error(`prisma migrate deploy exited with code ${status}`)
}

// Indirection so tests can stub pg_restore/migrate (CI's Postgres server
// version needn't match the runner's client), like backupDeps.
export const restoreDumpDeps = { readDumpMigrations, replaceDatabase, migrateDeploy }

export async function restoreDump(file: string, lockKey: bigint): Promise<void> {
  if (!(await isPgCustomDump(file))) throw new RestoreDumpError('invalidDump')

  let migrations: string[] | null
  try {
    migrations = await restoreDumpDeps.readDumpMigrations(file)
  } catch (err) {
    throw new RestoreDumpError('invalidDump', (err as Error).message)
  }
  if (!migrations || migrations.length === 0) throw new RestoreDumpError('invalidDump', 'No Famlin migrations')
  const unknown = findUnknownMigrations(migrations, await readLocalMigrations())
  if (unknown.length > 0) throw new RestoreDumpError('dumpTooNew', unknown.join(', '))

  await prisma.$transaction(
    async (tx) => {
      // Held until the restore and migrations are done, so POST /setup (same
      // key) can't create an account in between. The user count runs inside
      // a savepoint that's rolled back, which releases its lock on "User" —
      // otherwise pg_restore's DROP TABLE would wait on this transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      await tx.$executeRawUnsafe('SAVEPOINT famlin_restore_check')
      const users = await tx.user.count()
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT famlin_restore_check')
      if (users > 0) throw new RestoreDumpError('notEmpty')

      try {
        await restoreDumpDeps.replaceDatabase(file)
      } catch (err) {
        // The schema may now be empty: migrate it back to a usable fresh
        // install before reporting the failure.
        await restoreDumpDeps.migrateDeploy().catch(() => {})
        throw new RestoreDumpError('restoreFailed', (err as Error).message)
      }
      // A dump from an older version: bring it up to this one.
      try {
        await restoreDumpDeps.migrateDeploy()
      } catch (err) {
        throw new RestoreDumpError('restoreFailed', (err as Error).message)
      }
    },
    { maxWait: 30_000, timeout: 60 * 60_000 }
  )

  invalidateSettingsCache()
}
