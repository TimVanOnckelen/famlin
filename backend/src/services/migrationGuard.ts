import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PrismaClient } from '@prisma/client';

// The image's own migrations — resolves to backend/prisma/migrations both
// from src/services (tsx) and dist/services (the compiled image).
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

type RawQueryable = Pick<PrismaClient, '$queryRaw'>;

/** Migration folder names shipped with this build (each holds a migration.sql). */
export async function readLocalMigrations(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Names of the migrations the database has actually applied — finished and
 * not rolled back — or `null` for a fresh database that has never been
 * migrated (no `_prisma_migrations` table yet).
 */
export async function readAppliedMigrations(db: RawQueryable): Promise<string[] | null> {
  const [{ exists }] = await db.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass('_prisma_migrations') IS NOT NULL AS "exists"
  `;
  if (!exists) return null;
  const rows = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return rows.map((r) => r.migration_name);
}

/** Applied migrations this build doesn't know about, i.e. the database is newer than the code. */
export function findUnknownMigrations(applied: string[] | null, local: string[]): string[] {
  if (!applied) return [];
  const known = new Set(local);
  return applied.filter((name) => !known.has(name)).sort();
}

export function downgradeErrorMessage(unknown: string[], version: string): string {
  return (
    `Refusing to start: the database was upgraded by a newer Famlin version than this one (${version}). ` +
    `It has migration(s) this version doesn't know about: ${unknown.join(', ')}. ` +
    `Running older code against a newer schema can corrupt data, so nothing was migrated or started. ` +
    `To fix it, either set FAMLIN_VERSION back to the version that upgraded the database (or newer), ` +
    `or restore a database backup taken before that upgrade. ` +
    `See https://famlin.app/docs/maintenance#troubleshooting`
  );
}

/**
 * Throws (with an admin-facing message) when the database has migrations
 * applied that this build doesn't ship — an older image booted against a
 * schema migrated by a newer release. Must run *before* `prisma migrate
 * deploy`, which doesn't treat that as an error.
 */
export async function assertDatabaseNotNewer(
  db: RawQueryable,
  version: string,
  migrationsDir: string = MIGRATIONS_DIR
): Promise<void> {
  const unknown = findUnknownMigrations(await readAppliedMigrations(db), await readLocalMigrations(migrationsDir));
  if (unknown.length > 0) throw new DatabaseNewerError(downgradeErrorMessage(unknown, version), unknown);
}

export class DatabaseNewerError extends Error {
  constructor(
    message: string,
    readonly unknownMigrations: string[]
  ) {
    super(message);
    this.name = 'DatabaseNewerError';
  }
}
