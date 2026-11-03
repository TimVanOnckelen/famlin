import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 reads the connection string from here rather than from the
// schema's datasource block (which now carries only the provider).
//
// The datasource key is attached only when DATABASE_URL is actually set,
// and deliberately does NOT use prisma/config's env() helper: env() resolves
// eagerly and throws PrismaConfigEnvError when the variable is missing, which
// fails *loading this file at all* — including for commands that need no
// database. `prisma generate` is exactly that case, and it runs during the
// Docker image build, where no DATABASE_URL exists (and shouldn't: baking a
// production connection string into an image layer would be worse). Reading
// process.env directly keeps `generate` working there, while migrate/db
// commands still get the URL from the environment at runtime — and, when it
// genuinely is missing, now fail with Prisma's own "no datasource configured"
// message instead of a config-file load error.
//
// Zero-config start (#338): when DATABASE_URL isn't set, derive it from
// POSTGRES_* the same way src/bootstrapEnv.ts does (duplicated here because
// the production image ships this file without src/). The prisma CLI runs in
// its own process, so it cannot inherit the app's derivation otherwise.
function deriveDatabaseUrl(): string | undefined {
  const env = process.env
  let password = env.POSTGRES_PASSWORD
  if (!password && env.POSTGRES_PASSWORD_FILE) {
    password = readFileSync(env.POSTGRES_PASSWORD_FILE, 'utf8').trim()
  }
  if (!password) return undefined
  const user = encodeURIComponent(env.POSTGRES_USER || 'famlin')
  const db = encodeURIComponent(env.POSTGRES_DB || 'famlin')
  return `postgresql://${user}:${encodeURIComponent(password)}@${env.POSTGRES_HOST || 'famlin-db'}:${env.POSTGRES_PORT || '5432'}/${db}?schema=public`
}

const databaseUrl = process.env.DATABASE_URL || deriveDatabaseUrl()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
})
