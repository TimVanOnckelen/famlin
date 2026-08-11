import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

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
  // Where uploaded photos/videos are stored. Optional — the default is the
  // `uploads` directory next to the running server, which is where the
  // persistent Docker volume mounts, so no deployment needs to set this.
  // It exists so the test harness can point a run at a throwaway directory:
  // scripts/test-in-docker.sh execs into the dev container, whose real
  // uploads volume holds actual family media, and the suite both writes
  // fixtures into this directory and (via GET /api/admin/export) zips all of
  // it. Without an override, a dev instance with a few hundred MB of photos
  // makes the export tests time out and leaves test files behind.
  UPLOADS_DIR: z.string().optional(),
});

export const config = envSchema.parse(process.env);

// Resolved once, at import time — every module that touches the uploads
// directory must use this rather than recomputing it from process.cwd(), so
// an override applies everywhere (the upload route, the static file hook,
// cross-post asset copies, and the admin export) or nowhere.
export const uploadsDir = path.resolve(
  config.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads')
);
