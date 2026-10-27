import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.resolve(__dirname, '.env.test') })

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/setup/global-setup.ts'],
    setupFiles: ['./tests/setup/test-setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Every test file shares one Postgres database that gets truncated
    // between tests — running files in parallel would let them stomp on
    // each other's data.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL!,
      JWT_SECRET: process.env.JWT_SECRET!,
      PORT: process.env.PORT!,
      // Scheduled-backup tests write dumps and an uploads mirror here
      // (src/config.ts) — never into a real backups volume.
      BACKUPS_DIR: process.env.BACKUPS_DIR ?? path.join(os.tmpdir(), 'famlin-test-backups'),
    },
  },
})
