import { spawnSync } from 'child_process';
import { prisma } from './db.js';
import { assertDatabaseNotNewer, DatabaseNewerError } from './services/migrationGuard.js';
import pkg from '../package.json' with { type: 'json' };

// The production container's entrypoint (backend/Dockerfile's CMD):
// downgrade guard → `prisma migrate deploy` → server, all in one node process
// so node stays PID 1 and still receives docker stop's SIGTERM (src/server.ts).

async function boot() {
  try {
    await assertDatabaseNotNewer(prisma, pkg.version);
  } catch (err) {
    // One clear line, then a non-zero exit: the container's restart loop is
    // what makes this visible in `docker ps`. No read-only fallback — old code
    // over a newer schema can break even on reads.
    console.error(err instanceof DatabaseNewerError ? err.message : err);
    process.exit(1);
  }

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  await import('./server.js');
}

boot();
