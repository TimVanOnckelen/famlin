// The admin account the demo's sample data is seeded with
// (backend/prisma/seed.ts). Only shown on the login page while the server
// reports `readOnly` (READ_ONLY=true, the demo instance) — keep in sync with
// the seed.
export const DEMO_ADMIN_LOGIN = { email: 'admin@example.com', password: 'test123456' } as const
