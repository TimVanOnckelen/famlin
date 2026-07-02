import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';

// Runs once for the whole test run, in its own process — it doesn't share
// process.env with vitest.config.ts or the test files, so it loads
// .env.test itself before applying pending migrations to the test database.
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
