import { prisma } from './db.js'
import {
  assertDatabaseNotNewer,
  DatabaseNewerError,
  MigrateDeployError,
  runMigrateDeploy,
} from './services/migrationGuard.js'
import pkg from '../package.json' with { type: 'json' }

// The production container's entrypoint (backend/Dockerfile's CMD):
// downgrade guard → `prisma migrate deploy` → server, all in one node process
// so node stays PID 1 and still receives docker stop's SIGTERM (src/server.ts).

async function boot() {
  try {
    await assertDatabaseNotNewer(prisma, pkg.version)
  } catch (err) {
    // One clear line, then a non-zero exit: the container's restart loop is
    // what makes this visible in `docker ps`. No read-only fallback — old code
    // over a newer schema can break even on reads.
    console.error(err instanceof DatabaseNewerError ? err.message : err)
    process.exit(1)
  }

  try {
    await runMigrateDeploy()
  } catch (err) {
    // Prisma already printed why; exit with its code, as before.
    if (!(err instanceof MigrateDeployError)) console.error(err)
    process.exit(err instanceof MigrateDeployError ? err.exitCode : 1)
  }

  await import('./server.js')
}

boot()
