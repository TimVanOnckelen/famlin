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
      // Application tests always use local, throwaway storage. The S3 suites
      // construct isolated UUID buckets using TEST_S3_ENDPOINT explicitly.
      STORAGE_DRIVER: 'local',
      STORAGE_FALLBACK_DRIVER: '',
      UPLOADS_DIR: process.env.UPLOADS_DIR ?? path.join(os.tmpdir(), 'famlin-test-uploads'),
      DATABASE_URL: process.env.DATABASE_URL!,
      JWT_SECRET: process.env.JWT_SECRET!,
      PORT: process.env.PORT!,
      // Scheduled-backup tests write dumps and an uploads mirror here
      // (src/config.ts) — never into a real backups volume.
      BACKUPS_DIR: process.env.BACKUPS_DIR ?? path.join(os.tmpdir(), 'famlin-test-backups'),
    },
  },
})
