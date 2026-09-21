import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config.js';

// Prisma 7 removed `url` from the schema's datasource block: the CLI reads
// the connection string from prisma.config.ts, and the client takes it via a
// driver adapter instead of resolving env("DATABASE_URL") itself.
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
