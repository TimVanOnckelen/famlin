import 'dotenv/config';
import { defineConfig } from 'prisma/config';

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
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
