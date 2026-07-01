import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_IDS: z.string().optional().transform((s) => s ? s.split(',').map((id) => id.trim()) : []),
  ALLOWED_EMAILS: z.string().transform((s) => s.split(',').map((e) => e.trim().toLowerCase())),
  IMMICH_BASE_URL: z.string().optional(),
  IMMICH_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export const config = envSchema.parse(process.env);
