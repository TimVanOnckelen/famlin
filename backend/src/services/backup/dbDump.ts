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
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', args, {
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += chunk.toString()
      })
      child.on('error', (err) => {
        reject(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? new Error('pg_dump is not installed in this container')
            : err
        )
      })
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`))
      })
    })
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
