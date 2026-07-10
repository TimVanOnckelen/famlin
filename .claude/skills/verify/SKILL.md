---
name: verify
description: Build/launch/drive recipe for verifying Famlin UI changes end-to-end in a real browser.
---

# Verifying Famlin admin/web UI changes

## Backend

The dev backend usually already runs in Docker (`famlin-backend` + `famlin-db`, check with `docker ps`). If not, `cd backend && npm run dev`. It listens on `http://localhost:3000`.

Seeded dev fixture (from `prisma/seed.ts`, `npm run db:seed`): `admin@example.com` / `test123456` (admin). Login via `POST /api/auth/login` to grab a bearer token for API-level setup/cleanup, e.g.:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"test123456"}'
```

## Admin UI (`backend/admin/`)

```bash
cd backend/admin && npm run dev   # Vite dev server on http://localhost:5173/admin/, proxies /api to :3000
```

## Web app (`web/`)

```bash
npm run dev:web   # Vite dev server on http://localhost:5174, proxies /api to :3000
```

## Driving it — Playwright (no browser preinstalled in repo)

`playwright` isn't a repo dependency, but Chromium is already downloaded to `~/Library/Caches/ms-playwright` (from a prior global `npx playwright install`). Fastest cold start: install the npm package only (skips a redundant browser download since the cache already has a matching version) in the scratchpad dir, not the repo:

```bash
cd <scratchpad-dir> && npm init -y && npm install playwright@<version matching cache dir, e.g. 1.61.1>
node your-script.mjs   # import { chromium } from 'playwright'; chromium.launch()
```

Log in by filling `input[type="email"]` / `input[type="password"]` and clicking `button[type="submit"]` — same login form shape on both admin and web.

## Gotchas

- `.member-cards li` is reused across the Groups admin page for the invites list, the members list, and the linked-Immich-albums list — scope selectors to the right `.md-section-header` sibling block, don't grab `.member-cards li` unscoped if you need just one of them.
- Any invite/user/group created during verification is real dev DB state — clean it up afterward (`DELETE /api/admin/invites/:id`, etc.) using the admin bearer token rather than leaving test rows behind.
- Kill the Vite dev server you started (`pkill -f vite` or track the PID) once done — it doesn't self-terminate.
