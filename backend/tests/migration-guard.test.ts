import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db.js';
import {
  assertDatabaseNotNewer,
  DatabaseNewerError,
  readAppliedMigrations,
  readLocalMigrations,
} from '../src/services/migrationGuard.js';

// The boot entrypoint (src/boot.ts) runs this before `prisma migrate deploy`:
// an older image booted against a database a newer release already migrated
// must refuse to start. The test database is migrated by global-setup, so its
// `_prisma_migrations` matches this checkout's prisma/migrations exactly; each
// case fakes the image's migrations folder around that.
describe('downgrade guard', () => {
  let applied: string[];
  let tmpRoot: string;

  async function fakeMigrationsDir(names: string[]): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpRoot, 'migrations-'));
    for (const name of names) {
      await fs.mkdir(path.join(dir, name));
      await fs.writeFile(path.join(dir, name, 'migration.sql'), '');
    }
    await fs.writeFile(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
    return dir;
  }

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-migration-guard-'));
    applied = (await readAppliedMigrations(prisma)) ?? [];
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('matches the real migrations folder for the migrated test database', async () => {
    expect(applied.length).toBeGreaterThan(0);
    expect([...applied].sort()).toEqual((await readLocalMigrations()).sort());
    await expect(assertDatabaseNotNewer(prisma, '1.0.0')).resolves.toBeUndefined();
  });

  it('refuses when the database is ahead of the image', async () => {
    const newest = [...applied].sort().at(-1)!;
    const dir = await fakeMigrationsDir(applied.filter((name) => name !== newest));

    const err = await assertDatabaseNotNewer(prisma, '0.1.0', dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseNewerError);
    expect((err as DatabaseNewerError).unknownMigrations).toEqual([newest]);
    const message = (err as Error).message;
    expect(message).toContain(newest);
    expect(message).toContain('0.1.0');
    expect(message).toContain('FAMLIN_VERSION');
    expect(message).toContain('backup');
  });

  it('passes when the database is behind the image (a normal upgrade)', async () => {
    const dir = await fakeMigrationsDir([...applied, '29991231000000_not_applied_yet']);
    await expect(assertDatabaseNotNewer(prisma, '9.9.9', dir)).resolves.toBeUndefined();
  });

  it('passes on a fresh database with no _prisma_migrations table', async () => {
    const dir = await fakeMigrationsDir([]);
    // An empty search_path hides the public schema's _prisma_migrations, which
    // is exactly what a never-migrated database looks like to the guard.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL search_path TO pg_temp`;
      expect(await readAppliedMigrations(tx)).toBeNull();
      await expect(assertDatabaseNotNewer(tx, '1.0.0', dir)).resolves.toBeUndefined();
    });
  });

  it('ignores rolled-back and unfinished migrations', async () => {
    const dir = await fakeMigrationsDir(applied);
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`
        INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count)
        VALUES
          (gen_random_uuid()::text, 'x', '29990101000000_rolled_back', now(), now(), now(), 0),
          (gen_random_uuid()::text, 'x', '29990102000000_failed', now(), NULL, NULL, 0)
      `;
        await expect(assertDatabaseNotNewer(tx, '1.0.0', dir)).resolves.toBeUndefined();
        // Never leave fake rows behind in the shared test database.
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});

class Rollback extends Error {}
