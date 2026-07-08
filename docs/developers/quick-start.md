---
sidebar_position: 1
---

# Quick start

This guide is for **developers working on Famlin's code** — running the stack locally with hot reload, seeding test data, and iterating on the mobile app. If you just want to run Famlin for your family, see [Server setup](/server-setup) in the Docs tab instead.

You only need Docker to run the backend locally.

## 1. Environment variables

Copy the example file in the project root and edit the values:

```bash
cp .env.example .env
```

Fill in at least the following in `.env`:

- `JWT_SECRET` — a long random string (≥ 32 characters)

> For **local backend development without Docker** you can also use `backend/.env`. In Docker the values from the root `.env` are used.

## 2. Start the backend

```bash
docker compose up --build
```

The API is then available at http://localhost:3000.

## 3. Seed the database

In a second terminal:

```bash
docker compose exec famlin-backend npx prisma db seed
```

This creates a group "Familie de Vries" with sample users and posts.

## 4. Run backend tests

```bash
cd backend
npm run test:docker
```

This execs into the running `famlin-backend` container and runs the Vitest suite against a dedicated `<db>_test` database (created automatically on first run) — never the real one, since Postgres isn't published to the host and the suite refuses to run against any database without "test" in its name. Plain `npm test` only works if you have direct Postgres access (e.g. `DATABASE_URL` pointed at a local Postgres instead of Docker).

## 5. Run the web app

The member-facing web app (`web/`) and its shared API layer (`packages/api-client`) are npm workspaces at the repo root, so install there first:

```bash
npm install   # repo root — links and builds @famlin/api-client
```

Then pick a mode:

**Option A — Vite dev server (HMR, fastest iteration)**

```bash
npm run dev:web
```

Open http://localhost:5174 — `/api` requests are proxied to the backend container on port 3000.

**Option B — bundled, like production**

```bash
npm run build:web    # or: npm run watch:web (rebuilds on change)
```

This builds into `backend/dist/web`, which the dev compose overlay bind-mounts into the container — the backend then serves the web app at http://localhost:3000/ exactly as a production deployment would. After the **first** build, restart the backend once so it detects the new bundle (`docker compose restart famlin-backend`); subsequent rebuilds only need a browser refresh.

> After changing `packages/api-client/src/`, rebuild it with `npm run build:api-client` (or rerun the root `npm install`) — the mobile app and the web app both consume the compiled `dist/`, not the TypeScript source.

## 6. Test the mobile app

If you have Node installed locally (and the backend is already running in Docker):

```bash
npm install      # repo root first — mobile's @famlin/api-client file: dependency
                 # needs the workspace install to build (its prepare script
                 # fails with "tsc: command not found" otherwise)
cd mobile
cp .env.example .env
npm install
npm run ios      # or npm run android
```

Scan the QR code with the Camera app (iOS) or the Expo Go app (Android).

> The backend server address is not hardcoded. At login the user enters the address themselves (for example `https://famlin.yourdomain.com`). For local development `http://localhost:3000` is used automatically if the field is left empty.
>
> SSO login is configured entirely on the server (issuer, client ID, scopes) — the mobile app and admin UI discover it automatically, no build-time client IDs needed.

## Useful commands

```bash
# Follow backend logs
docker compose logs -f famlin-backend

# Reset the database
docker compose down -v
docker compose up --build

# Create a Prisma migration
docker compose exec famlin-backend npx prisma migrate dev --name description

# Open Prisma Studio
docker compose exec famlin-backend npx prisma studio

# Run the backend test suite
cd backend && npm run test:docker

# Run the mobile test suite (Jest, no device/simulator needed)
cd mobile && npm test

# Run the shared API client test suite (Vitest)
cd packages/api-client && npm test

# Run the web app test suite (Vitest + Testing Library, jsdom)
cd web && npm test

# Rebuild the shared API client after changing packages/api-client/src/
npm run build:api-client

# Build the web app into backend/dist/web (served by the backend at /)
npm run build:web

# ...or rebuild it automatically on every change
npm run watch:web
```

## Production deployment

Ready to run Famlin on a real server? Start with the [Server setup](/server-setup) guide for the Docker Compose stack and reverse proxy, then [Admin configuration](/admin-configuration) for OIDC/SSO, [Inviting family members](/inviting-family), and [Maintenance](/maintenance) for backups and updates.
