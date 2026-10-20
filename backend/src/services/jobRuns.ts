import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { config } from '../config.js'

// Every background job the admin status panel reports on. The ids are
// persisted as JobStatus primary keys — don't rename them.
export const JOB_IDS = ['onThisDay', 'newAssets', 'expireStories', 'backup', 'systemAlerts'] as const
export type JobId = (typeof JOB_IDS)[number]

const MAX_ERROR_LENGTH = 500

// A job's error message is shown to admins in the status panel (it's what
// makes a failing pg_dump diagnosable), so keep it short and make sure the
// database password can never end up in it, whatever a child process echoes.
export function sanitizeJobError(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err)
  try {
    const password = new URL(config.DATABASE_URL).password
    if (password) message = message.split(decodeURIComponent(password)).join('***').split(password).join('***')
  } catch {
    // An unparseable DATABASE_URL can't have leaked into the message either.
  }
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

// Wraps one run of a job: marks it started, then records its outcome
// (duration, error, and whatever `details` the job returns) on the job's
// single JobStatus row. Rethrows the job's error so callers keep their own
// logging. Bookkeeping failures are swallowed — a status-table hiccup must
// never fail the job itself.
export async function recordJobRun<T>(
  job: JobId,
  fn: () => Promise<T>,
  details?: (result: T) => Prisma.InputJsonValue | undefined
): Promise<T> {
  const startedAt = new Date()
  await prisma.jobStatus
    .upsert({
      where: { job },
      create: { job, lastStartedAt: startedAt },
      update: { lastStartedAt: startedAt, lastFinishedAt: null, lastOk: null, lastError: null, lastDurationMs: null },
    })
    .catch((err) => console.error(`Failed to record start of job ${job}`, err))

  try {
    const result = await fn()
    const finishedAt = new Date()
    await prisma.jobStatus
      .update({
        where: { job },
        data: {
          lastFinishedAt: finishedAt,
          lastOk: true,
          lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
          lastSuccessAt: finishedAt,
          lastDetails: details?.(result) ?? Prisma.DbNull,
        },
      })
      .catch((err) => console.error(`Failed to record result of job ${job}`, err))
    return result
  } catch (err) {
    const finishedAt = new Date()
    await prisma.jobStatus
      .update({
        where: { job },
        data: {
          lastFinishedAt: finishedAt,
          lastOk: false,
          lastError: sanitizeJobError(err),
          lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
          lastFailureAt: finishedAt,
          lastDetails: Prisma.DbNull,
        },
      })
      .catch((e) => console.error(`Failed to record failure of job ${job}`, e))
    throw err
  }
}
