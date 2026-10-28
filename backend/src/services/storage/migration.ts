import { createHash } from 'node:crypto'
import { prisma } from '../../db.js'
import { getStorageConfiguration, isMediaKey } from './registry.js'
import { withStorageKey } from './locks.js'
import type { StorageBackend } from './types.js'

export class StorageMigrationError extends Error {}
const JOB_LOCK = 221028
let running: Promise<void> | null = null
let starting = false

export async function hashObject(
  backend: StorageBackend,
  key: string
): Promise<{ sha256: string; size: number } | null> {
  const object = await backend.get(key)
  if (!object) return null
  const hash = createHash('sha256')
  let size = 0
  try {
    for await (const chunk of object.stream) {
      hash.update(chunk)
      size += chunk.length
    }
    return { sha256: hash.digest('hex'), size }
  } finally {
    object.stream.destroy()
  }
}

function configured() {
  const { primary, fallback } = getStorageConfiguration()
  if (!fallback) throw new StorageMigrationError('No fallback source configured')
  return { primary, fallback }
}

export async function storageStatus() {
  const { primary, fallback } = getStorageConfiguration()
  async function describe(c: typeof primary) {
    try {
      let files = 0,
        bytes = 0
      for await (const o of c.backend.list()) {
        if (isMediaKey(o.key)) {
          files++
          bytes += o.size
        }
      }
      return { ...c.location, fingerprint: c.fingerprint, available: true, files, bytes }
    } catch {
      return { ...c.location, fingerprint: c.fingerprint, available: false, files: null, bytes: null }
    }
  }
  const migration = fallback
    ? await prisma.storageMigration.findUnique({
        where: { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } },
      })
    : null
  const progress = migration
    ? await prisma.storageMigrationItem.groupBy({
        by: ['status'],
        where: { migrationId: migration.id },
        _count: true,
        _sum: { size: true },
      })
    : []
  const errors = migration
    ? await prisma.storageMigrationItem.findMany({
        where: { migrationId: migration.id, status: { in: ['error', 'conflict'] } },
        take: 100,
        select: { key: true, status: true, error: true },
      })
    : []
  return {
    primary: await describe(primary),
    fallback: fallback ? await describe(fallback) : null,
    migration,
    progress: progress.map((p) => ({ status: p.status, files: p._count, bytes: Number(p._sum.size ?? 0) })),
    errors,
  }
}

export async function startStorageMigration(cleanupSource?: string): Promise<void> {
  const { primary, fallback } = configured()
  if (running || starting) throw new StorageMigrationError('Storage operation already running')
  starting = true
  try {
    const where = { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } }
    if (cleanupSource !== undefined) {
      if (cleanupSource !== fallback.fingerprint) throw new StorageMigrationError('Source confirmation does not match')
      const job = await prisma.storageMigration.findUnique({ where })
      if (!job || !['verified', 'cleaning', 'cleanup_failed', 'cleaned'].includes(job.status))
        throw new StorageMigrationError('Migration must be fully verified before cleanup')
      if (await prisma.storageMigrationItem.count({ where: { migrationId: job.id, status: 'conflict' } }))
        throw new StorageMigrationError('Resolve conflicts and rerun migration before cleanup')
    }
    // The journal is committed per object, outside the lock-holding transaction.
    // A killed worker leaves a resumable status and no falsely verified item.
    running = run(cleanupSource !== undefined).finally(() => {
      running = null
    })
    void running.catch(() => {})
  } finally {
    starting = false
  }
}

async function run(cleanup: boolean) {
  const { primary, fallback } = configured()
  await prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${JOB_LOCK}) AS locked`
      if (!lock.locked) return
      const where = { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } }
      const job = await prisma.storageMigration.upsert({
        where,
        create: { source: fallback.fingerprint, destination: primary.fingerprint },
        update: {},
      })
      // Recheck after acquiring the global lock, across all backend instances.
      if (cleanup && !['verified', 'cleaning', 'cleanup_failed', 'cleaned'].includes(job.status)) return
      if (cleanup && (await prisma.storageMigrationItem.count({ where: { migrationId: job.id, status: 'conflict' } })))
        return
      const passStartedAt = new Date()
      await prisma.storageMigration.update({
        where: { id: job.id },
        data: { status: cleanup ? 'cleaning' : 'running', error: null },
      })
      let failures = 0
      try {
        for await (const entry of fallback.backend.list()) {
          if (!isMediaKey(entry.key)) continue
          await withStorageKey(entry.key, async (keyTx) => {
            const itemWhere = { migrationId_key: { migrationId: job.id, key: entry.key } }
            try {
              const source = await hashObject(fallback.backend, entry.key)
              if (!source) return // deleted by the application since list()
              const existing = await keyTx.storageMigrationItem.findUnique({ where: itemWhere })
              if (
                cleanup &&
                (!existing || !['verified', 'error'].includes(existing.status) || existing.sha256 !== source.sha256)
              ) {
                // Cleaned items can only reappear through an external writer.
                throw new StorageMigrationError('Source is unverified or has changed')
              }
              let destination = await hashObject(primary.backend, entry.key)
              if (!destination && !cleanup) {
                const object = await fallback.backend.get(entry.key)
                if (!object) return
                try {
                  await primary.backend.put(entry.key, object.stream)
                } finally {
                  object.stream.destroy()
                }
                destination = await hashObject(primary.backend, entry.key)
              }
              if (!destination || source.sha256 !== destination.sha256 || source.size !== destination.size)
                throw new StorageMigrationError('SHA-256 conflict; neither object was overwritten')
              // External source changes during copy also invalidate verification.
              const sourceAgain = await hashObject(fallback.backend, entry.key)
              if (!sourceAgain || sourceAgain.sha256 !== source.sha256)
                throw new StorageMigrationError('Source changed during verification')
              if (cleanup) await fallback.backend.delete(entry.key)
              await keyTx.storageMigrationItem.upsert({
                where: itemWhere,
                create: {
                  migrationId: job.id,
                  key: entry.key,
                  size: BigInt(source.size),
                  sha256: source.sha256,
                  status: cleanup ? 'cleaned' : 'verified',
                },
                update: {
                  size: BigInt(source.size),
                  sha256: source.sha256,
                  status: cleanup ? 'cleaned' : 'verified',
                  error: null,
                },
              })
            } catch (error) {
              failures++
              const conflict = error instanceof StorageMigrationError
              await keyTx.storageMigrationItem.upsert({
                where: itemWhere,
                create: {
                  migrationId: job.id,
                  key: entry.key,
                  size: BigInt(entry.size),
                  status: conflict ? 'conflict' : 'error',
                  error: conflict ? error.message : 'Storage operation failed',
                },
                update: {
                  size: BigInt(entry.size),
                  status: conflict ? 'conflict' : 'error',
                  error: conflict ? error.message : 'Storage operation failed',
                },
              })
            }
          })
        }
        // A crash may happen after source deletion but before the journal
        // commit. Reconcile old entries absent from this pass in bounded pages.
        let cursor: string | undefined
        for (;;) {
          const stale = await prisma.storageMigrationItem.findMany({
            where: {
              migrationId: job.id,
              updatedAt: { lt: passStartedAt },
              status: { in: ['verified', 'error', 'conflict'] },
              ...(cursor ? { key: { gt: cursor } } : {}),
            },
            orderBy: { key: 'asc' },
            take: 100,
          })
          if (!stale.length) break
          for (const item of stale) {
            await withStorageKey(item.key, async (keyTx) => {
              if (await fallback.backend.stat(item.key)) return
              let status = 'source_removed'
              if (cleanup) {
                const destination = await hashObject(primary.backend, item.key)
                status = destination && destination.sha256 === item.sha256 ? 'cleaned' : 'conflict'
              }
              await keyTx.storageMigrationItem.updateMany({
                where: { migrationId: job.id, key: item.key, status: { not: 'deleted' } },
                data: { status, error: status === 'conflict' ? 'Destination changed after source removal' : null },
              })
            })
          }
          cursor = stale[stale.length - 1].key
        }
        // Errors left by a previous pass must never silently permit cleanup.
        const unresolved = await prisma.storageMigrationItem.count({
          where: { migrationId: job.id, status: { in: ['error', 'conflict'] } },
        })
        await prisma.storageMigration.update({
          where: { id: job.id },
          data: {
            status: failures || unresolved ? (cleanup ? 'cleanup_failed' : 'failed') : cleanup ? 'cleaned' : 'verified',
          },
        })
      } catch {
        await prisma.storageMigration.update({
          where: { id: job.id },
          data: {
            status: cleanup ? 'cleanup_failed' : 'failed',
            error: 'Storage enumeration or journal operation failed',
          },
        })
      }
    },
    { maxWait: 30_000, timeout: 24 * 60 * 60_000 }
  )
}

export async function resumeStorageMigration() {
  const { primary, fallback } = getStorageConfiguration()
  if (!fallback) return
  const job = await prisma.storageMigration.findUnique({
    where: { source_destination: { source: fallback.fingerprint, destination: primary.fingerprint } },
  })
  if (job?.status === 'running') await startStorageMigration()
  if (job?.status === 'cleaning') await startStorageMigration(fallback.fingerprint)
}
