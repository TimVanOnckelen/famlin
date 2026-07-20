import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  // Only enable when the server sits behind a reverse proxy that itself sets
  // (and overwrites, never merely appends) X-Forwarded-*. With this off,
  // those headers are ignored — otherwise a directly-exposed server would let
  // any client spoof its own origin/host.
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Demo mode: block all mutating requests (POST/PUT/PATCH/DELETE) except
  // login/session endpoints, so visitors can browse sample data but cannot
  // post, comment, like, upload, or modify anything.
  READ_ONLY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export const config = envSchema.parse(process.env);
