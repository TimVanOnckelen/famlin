import type { Prisma } from '@prisma/client'
import { prisma } from '../../db.js'

// All instances use this namespace. The transaction pins a connection for
// the duration of the operation, so locks are released even after a crash.
export function withStorageKey<T>(key: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withStorageKeys([key], work)
}

export function withStorageKeys<T>(keys: string[], work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      for (const key of [...new Set(keys)].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(221, hashtext(${key}))`
      return work(tx)
    },
    { maxWait: 60_000, timeout: 24 * 60 * 60_000 }
  )
}
