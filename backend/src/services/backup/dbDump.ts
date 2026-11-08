import { spawn } from 'child_process'
import fsp from 'fs/promises'
import path from 'path'
import { config } from '../../config.js'

const DUMP_PREFIX = 'famlin-'
const DUMP_SUFFIX = '.dump'
const PARTIAL_SUFFIX = '.partial'

// `famlin-2026-10-20T03-00-00-000Z.dump`: ISO timestamp with the colons and
// dot swapped out (filesystem-safe), so lexical order is chronological order.
export function dumpFileName(now: Date): string {
  return `${DUMP_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}${DUMP_SUFFIX}`
}

function isDumpFile(name: string): boolean {
  return name.startsWith(DUMP_PREFIX) && name.endsWith(DUMP_SUFFIX)
}

// Exactly what dumpFileName() produces: no path separators or dots outside
// the suffix, so a matching name can only ever resolve inside the dump dir.
const DUMP_NAME_PATTERN = /^famlin-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.dump$/

/** When the dump was taken, from its file name, or `null` if `name` isn't a scheduled-backup dump name. */
export function parseDumpFileName(name: string): Date | null {
  const m = DUMP_NAME_PATTERN.exec(name)
  if (!m) return null
  const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export class PgToolNotInstalledError extends Error {
  constructor(readonly tool: string) {
    super(`${tool} is not installed in this container`)
    this.name = 'PgToolNotInstalledError'
  }
}

/**
 * Runs a Postgres client tool (pg_dump/pg_restore) with the password in
 * PGPASSWORD. Rejects on a non-zero exit with (the first 4000 chars of) its
 * stderr. With `maxStdout`, stdout is captured and returned; more than that
 * many bytes kills the tool and rejects. Without it, stdout is discarded.
 */
export function runPgTool(tool: string, args: string[], password: string, maxStdout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', maxStdout === undefined ? 'ignore' : 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let overflow = false
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > (maxStdout ?? 0)) {
        overflow = true
        child.kill()
      } else {
        stdout.push(chunk)
      }
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString()
    })
    child.on('error', (err) => {
      reject((err as NodeJS.ErrnoException).code === 'ENOENT' ? new PgToolNotInstalledError(tool) : err)
    })
    child.on('close', (code) => {
      if (overflow) reject(new Error(`${tool} printed more than ${maxStdout} bytes`))
      else if (code === 0) resolve(Buffer.concat(stdout).toString())
      else reject(new Error(stderr.trim() || `${tool} exited with code ${code}`))
    })
  })
}

// pg_dump takes a libpq URI, which rejects Prisma's `?schema=` parameter, and
// a password in the URI would show up in `ps` — so the password moves to
// PGPASSWORD and the schema becomes --schema.
export function pgDumpConnection(databaseUrl: string): { uri: string; password: string; schema: string | null } {
  const url = new URL(databaseUrl)
  const schema = url.searchParams.get('schema')
  url.searchParams.delete('schema')
  const password = decodeURIComponent(url.password)
  url.password = ''
  return { uri: url.toString(), password, schema }
}

// `pg_dump -Fc` (custom format: compressed, restorable with pg_restore) into
// `<dir>/<dumpFileName>`. Written to a `.partial` file first and renamed on
// success, so a crash or a full disk never leaves a truncated file that looks
// like a valid dump to retention or to an admin restoring from it.
export async function dumpDatabase(dir: string, now: Date): Promise<{ file: string; bytes: number }> {
  await fsp.mkdir(dir, { recursive: true })
  const finalPath = path.join(dir, dumpFileName(now))
  const partialPath = finalPath + PARTIAL_SUFFIX
  const { uri, password, schema } = pgDumpConnection(config.DATABASE_URL)
  const args = ['-Fc', '--no-owner', '--no-privileges', '-f', partialPath, ...(schema ? ['--schema', schema] : []), uri]

  try {
    await runPgTool('pg_dump', args, password)
    await fsp.rename(partialPath, finalPath)
  } catch (err) {
    await fsp.rm(partialPath, { force: true })
    throw err
  }

  const { size } = await fsp.stat(finalPath)
  return { file: path.basename(finalPath), bytes: size }
}

// Keeps the `keep` newest dumps in `dir` and deletes the rest, plus any
// leftover `.partial` file from an interrupted run. Returns the deleted names.
export async function pruneDbDumps(dir: string, keep: number): Promise<string[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const dumps = names.filter(isDumpFile).sort().reverse()
  const toDelete = [...dumps.slice(Math.max(keep, 1)), ...names.filter((n) => n.endsWith(DUMP_SUFFIX + PARTIAL_SUFFIX))]
  for (const name of toDelete) {
    await fsp.rm(path.join(dir, name), { force: true })
  }
  return toDelete
}
