import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { assertTestDatabase } from "./assert-test-database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");

// Runs once for the whole test run, in its own process — it doesn't share
// process.env with vitest.config.ts or the test files, so it loads
// .env.test itself before applying pending migrations to the test database.
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(backendRoot, ".env.test") });
  assertTestDatabase();

  execSync("npx prisma migrate deploy", {
    cwd: backendRoot,
    stdio: "inherit",
    env: process.env,
  });
}
