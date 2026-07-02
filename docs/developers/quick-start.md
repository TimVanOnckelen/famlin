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

## 5. Test the mobile app

### Option A — Expo web preview in Docker

```bash
docker compose -f docker-compose.mobile.yml up
```

Open http://localhost:8081 in your browser.

> Note: native features such as push notifications, camera, and SSO login will not work in the web preview.

### Option B — Local Expo development build

If you have Node installed locally (and the backend is already running in Docker):

```bash
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
```

## Production deployment

Ready to run Famlin on a real server? Start with the [Server setup](/server-setup) guide for the Docker Compose stack and reverse proxy, then [Admin configuration](/admin-configuration) for OIDC/SSO, [Inviting family members](/inviting-family), and [Maintenance](/maintenance) for backups and updates.
