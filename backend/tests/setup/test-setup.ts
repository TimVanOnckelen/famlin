import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/db.js';
import { __resetSettingsCacheForTests } from '../../src/services/settings.js';
import { assertTestDatabase } from './assert-test-database.js';

// Runs once per test file (vitest gives each file its own module registry,
// so this beforeAll only applies to that file's suite) rather than before
// every single test — some suites build shared fixtures once in their own
// top-level beforeAll and reuse them across `it`s, which a per-test
// truncation would wipe out mid-suite.
beforeAll(async () => {
  assertTestDatabase();

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;

  if (tables.length > 0) {
    const names = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }

  __resetSettingsCacheForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});
