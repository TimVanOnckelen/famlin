import { resumeStorageMigration } from './services/storage/migration.js'
import cron from 'node-cron'
import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'
import { runOnThisDayJob } from './jobs/onThisDay.js'
import { runNewAssetsJob } from './jobs/newAssets.js'
import { runExpireStoriesJob } from './jobs/expireStories.js'
import { recordJobRun } from './services/jobRuns.js'
import { runScheduledBackupIfDue } from './services/backup/index.js'
import { runSystemAlertsCheck } from './services/systemAlerts.js'

// Just under docker-compose.yml's stop_grace_period (30s).
const SHUTDOWN_TIMEOUT_MS = 25_000

async function start() {
  const fastify = await buildApp()

  try {
    const port = Number(config.PORT)
    await fastify.listen({ port, host: '0.0.0.0' })
    fastify.log.info(`Famlin backend running on port ${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }

  resumeStorageMigration().catch(() => fastify.log.error('Storage migration resume failed'))

  // Fixed daily time (server-local) rather than an admin-configurable
  // setting — kept simple for an MVP-scale feature.
  const onThisDayTask = cron.schedule('0 8 * * *', () => {
    recordJobRun('onThisDay', () => runOnThisDayJob()).catch((err) => fastify.log.error(err, 'on-this-day job failed'))
  })

  // Hourly, offset from the top of the hour so it doesn't compete with other
  // scheduled work — surfaces newly-added assets on MANUAL/AUTO-mode linked
  // albums (see src/jobs/newAssets.ts).
  const newAssetsTask = cron.schedule('15 * * * *', () => {
    recordJobRun('newAssets', () => runNewAssetsJob()).catch((err) => fastify.log.error(err, 'new-assets job failed'))
  })

  // Every 10 minutes: deletes stories that expired without being pinned,
  // media included (see src/jobs/expireStories.ts). Also run once at boot so
  // a server that was down for a while doesn't keep expired media around
  // until the first tick.
  const expireStories = () =>
    recordJobRun(
      'expireStories',
      () => runExpireStoriesJob(),
      (deleted) => ({ deleted })
    ).catch((err) => fastify.log.error(err, 'expire-stories job failed'))
  const expireStoriesTask = cron.schedule('*/10 * * * *', expireStories)
  expireStories()

  // Every hour on the hour: starts the scheduled backup when it's due (opt-in,
  // admin-configured hour and daily/weekly schedule — see isBackupDue() in
  // services/backup/index.ts). Checking hourly instead of scheduling the
  // configured time directly means a settings change applies without
  // rescheduling anything. The alert check runs right after a backup so a
  // failure is emailed straight away rather than at the next :45 tick.
  const backupTask = cron.schedule('0 * * * *', () => {
    runScheduledBackupIfDue()
      .then(
        (result) => result !== null,
        (err) => {
          fastify.log.error(err, 'scheduled backup failed')
          return true
        }
      )
      .then((ran) => (ran ? runSystemAlertsCheck() : undefined))
      .catch((err) => fastify.log.error(err, 'system alerts check failed'))
  })

  // Hourly: emails admins about a failed/stale backup or low disk space (at
  // most once per condition per day — services/systemAlerts.ts).
  const systemAlertsTask = cron.schedule('45 * * * *', () => {
    recordJobRun(
      'systemAlerts',
      () => runSystemAlertsCheck(),
      (emailed) => ({ emailed })
    ).catch((err) => fastify.log.error(err, 'system alerts job failed'))
  })

  // `docker stop` sends SIGTERM, then SIGKILLs after the compose file's
  // stop_grace_period (30s). Drain in-flight requests (an upload mid-write)
  // instead of dying with them: fastify.close() stops accepting connections,
  // answers new requests on kept-alive ones with 503, and resolves once the
  // in-flight ones finish. The hard exit stays inside the grace period so a
  // stuck request can't turn a clean shutdown into a SIGKILL.
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    fastify.log.info({ signal }, 'shutting down')
    setTimeout(() => {
      fastify.log.error('graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
    for (const task of [onThisDayTask, newAssetsTask, expireStoriesTask, backupTask, systemAlertsTask]) task.stop()
    try {
      await fastify.close()
      await prisma.$disconnect()
      process.exit(0)
    } catch (err) {
      fastify.log.error(err, 'error during shutdown')
      process.exit(1)
    }
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

start()
