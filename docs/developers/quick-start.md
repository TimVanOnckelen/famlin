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

This creates two groups, "The Miller Family" and "Ardennes Weekend", with sample users and content for every feature (posts with generated photos, an album, an event, a circle, a gift list, chat, wiki pages, stories and notifications), in English. The seed lives in `backend/prisma/seed.ts` and `backend/prisma/demoContent.ts`; the photos are painted by `backend/prisma/demoPhotos.ts`.

## 4. Run backend tests

```bash
cd backend
npm run test:docker
```

This execs into the running `famlin-backend` container and runs the Vitest suite against a dedicated `<db>_test` database (created automatically on first run) — never the real one, since Postgres isn't published to the host and the suite refuses to run against any database without "test" in its name. Plain `npm test` only works if you have direct Postgres access (e.g. `DATABASE_URL` pointed at a local Postgres instead of Docker).

### End-to-end smoke tests

`e2e/` holds a small [Playwright](https://playwright.dev) suite that drives a running instance through its golden paths in Chromium: the first-run admin setup, a family and an invite, a member joining through it, a post with a photo, a reaction and a comment (re-checked after a reload, since the UI updates optimistically), that someone signed out or outside the family can't read the post or its photo, and that the member's data export contains their post and comment. CI runs it in the `docker` job against the image that job just built, started with the real `docker-compose.yml`. The tests need a **fresh database**, since the first one runs the one-time setup. To run them locally:

```bash
# Stop the dev stack first: both publish port 3000.
docker compose down

# Build the image and start it with the production compose file.
docker build -f backend/Dockerfile -t ghcr.io/timvanonckelen/famlin:e2e .
FAMLIN_VERSION=e2e docker compose -p famlin-e2e -f docker-compose.yml up -d

# Run the tests (once curl -f http://localhost:3000/health succeeds).
cd e2e
npm install
npx playwright install chromium
npm test

# Throw the instance away; the next run needs a fresh database again.
cd ..
docker compose -p famlin-e2e -f docker-compose.yml down -v
```

Point the tests at another address with `FAMLIN_URL=http://host:port npm test`. A failed CI run uploads the Playwright report and traces as the `e2e-report` artifact; open a trace with `npx playwright show-trace <trace.zip>`.

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

### Admin UI and shared components

The dev container rebuilds admin automatically and serves it at
http://localhost:3000/admin/. Shared UI and token sources under `packages/`
are available through the repository mount for the same watch-build.

For the admin Vite dev server on the host, install the root workspace:

```bash
npm ci                               # installs admin, web and shared packages
npm run dev:admin
```

Open http://localhost:5173/admin/. For component ownership, token generation,
checks and future web adoption, see [Shared UI](./shared-ui.md).

## 6. Test the mobile app on a simulator or emulator

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

`npm run ios` / `npm run android` are `expo run:ios` / `expo run:android`: they generate the native project (`mobile/ios`, `mobile/android` — both gitignored build output), compile it, install it on a booted simulator/emulator, and start Metro. The first run takes several minutes; later runs are incremental, and a JS-only change needs no rebuild at all — `npm start` and reload.

**Famlin cannot run in Expo Go.** It uses `expo-dev-client` plus native modules Expo Go doesn't bundle (notifications, media library, secure store, video), so a native build is required; the QR code that `npm start` prints opens the app you built above, not Expo Go.

Pick a target device with `--device` when more than one is available:

```bash
npx expo run:android --device Pixel_7          # an AVD name from `emulator -list-avds`
npx expo run:ios --device "iPhone 17"          # a simulator name from `xcrun simctl list devices`
```

After changing native dependencies or anything in `app.config.js` (permissions, plugins, icons), regenerate the native project before rebuilding — a stale one silently keeps the old native config:

```bash
npx expo prebuild --clean       # add -p android / -p ios to limit it to one platform
```

`npm run ios` / `npm run android` do this for you when the existing native project was generated for the other app variant (see below); after any other `app.config.js` change, run it yourself.

### Development variant: install next to the store app

A plain `npm run android` / `npm run ios` builds the production app id (`be.xeweb.famlin`), so on a phone that also has Famlin from the App Store or Google Play it replaces that install (or fails with `INSTALL_FAILED_VERSION_DOWNGRADE`) and shares its login and drafts. Build the **development variant** instead to keep both side by side:

```bash
npm run android:dev
```

```bash
npm run ios:dev
```

| | Store app | Development variant |
| --- | --- | --- |
| Bundle id / package | `be.xeweb.famlin` | `be.xeweb.famlin.dev` |
| Name on the home screen | Famlin | Famlin (dev) |
| Icon | teal | orange, with a "DEV" label |

Both scripts set `APP_VARIANT=development`, which `mobile/app.config.js` reads, and run `scripts/run-native.mjs`. That script regenerates `android/`/`ios/` with `expo prebuild --clean` when they were generated for the other variant, so switching back and forth just works (at the cost of one full native rebuild per switch). Extra arguments go after `--`, e.g. `npm run android:dev -- --device Pixel_7`.

This is **local-only**. No `eas.json` profile sets `APP_VARIANT`, so every EAS and CI build — `development`, `preview`, `production`, `apk` — stays the production app id.

**Measuring performance:** a debug build runs the JS bundle in development mode and is much slower than what users get, so judge scrolling and animations in a Release build of the dev variant: `npm run android:dev -- --variant release` or `npm run ios:dev -- --configuration Release --device`.

The dev icons are generated from the production ones by `python3 scripts/generate-dev-icons.py` (Pillow); re-run it after changing `assets/icon.png` or `assets/adaptive-icon.png`.

Things the variant does **not** separate, and what to know about them:

- **Deep links share the `famlin://` scheme** on purpose (less to configure). With both apps installed, Android asks which app should open an invite link, a `/connect` link or the server-mediated (Google) SSO callback; on iOS it's undefined which app gets them, and the dev app's share extension may hand shared photos to the store app. Plain PKCE SSO login is unaffected, because its redirect URI comes from `makeRedirectUri()`. Uninstall one of the two when testing those flows.
- **Push notifications on Android** need `be.xeweb.famlin.dev` registered as a second Android app in the same Firebase project, and the downloaded `mobile/google-services.json` (which then lists both packages) committed. Until then `app.config.js` builds the dev variant without Firebase and logs a warning: everything works except push. Expo's push service also needs the FCM V1 key assigned to the new package: `eas credentials` → Android → `be.xeweb.famlin.dev` → Push Notifications. This only configures credentials; it doesn't start an EAS build.
- **Push notifications on iOS** need a physical device (the simulator has no APNs), an App ID for `be.xeweb.famlin.dev` with the Push Notifications capability in the Apple Developer account, and the APNs key assigned to that bundle id in `eas credentials`. Building on a device with Xcode's automatic signing registers the App IDs (`be.xeweb.famlin.dev`, `be.xeweb.famlin.dev.share-extension`) and the App Group `group.be.xeweb.famlin.dev` for you.
- **Sign in with Apple** against your own server: the server only accepts `be.xeweb.famlin` as audience by default, so add `be.xeweb.famlin.dev` to **Extra Apple bundle IDs** (`/admin` → Server settings).

### Running on your own iPhone

The Famlin bundle ids (`be.xeweb.famlin`, `be.xeweb.famlin.dev`) belong to the project's Apple Developer team, and Apple lets a bundle id belong to one team only, so Xcode can't sign them with your account. Give the build your own ids instead, in `mobile/.env.local` (gitignored; Expo CLI loads it before evaluating `app.config.js`, and nothing in the repository changes):

```bash
# mobile/.env.local
FAMLIN_IOS_BUNDLE_ID=com.yourname.famlin
FAMLIN_IOS_TEAM_ID=ABCDE12345
```

| Variable | What it does |
| --- | --- |
| `FAMLIN_IOS_BUNDLE_ID` | Your bundle id. The development variant appends `.dev`, the share extension `.share-extension`, and its App Group becomes `group.<your id>`. |
| `FAMLIN_IOS_TEAM_ID` | Your Apple team id (Xcode → Settings → Accounts, or developer.apple.com → Membership), so Xcode signs without editing the project. |
| `FAMLIN_IOS_FREE_TEAM=1` | Only for a **free Apple account** (a "Personal Team"). Such an account can't sign push notifications, Sign in with Apple or App Groups, so this leaves the three out of the iOS build. |

Then build to the connected phone as usual: `npm run ios -- --device` (or `npm run ios:dev -- --device`). `scripts/run-native.mjs` reads the resolved ids from `app.config.js`, so it regenerates `ios/` by itself when you add, change or remove these settings.

With a **paid** account you get the full app. With `FAMLIN_IOS_FREE_TEAM=1` everything works except:

- **Push notifications**: the app doesn't register for push (`src/utils/iosFreeTeam.ts`).
- **Sign in with Apple**: the button is hidden. Log in with a password or SSO.
- **Share → Famlin**: there's no share extension, so Famlin isn't in the iOS share sheet.

Apple's limits for free accounts still apply: the installed app stops launching after 7 days (build it again), and a device takes at most 3 such apps.

Sign in with Apple under your own bundle id (paid account) also needs that id in **Extra Apple bundle IDs** (`/admin` → Server settings) on the server you sign in to.

These settings are for local builds only: `app.config.js` refuses to build when any `FAMLIN_IOS_*` variable is set on EAS, and Android ignores them. When you add an iOS capability to the app, check whether a free account can sign it; if not, add its entitlement to `FREE_TEAM_UNSIGNABLE_ENTITLEMENTS` in `app.config.js`, or this build breaks again.

Then point the app at your local backend on the first launch screen:

| Where the app runs | Server address to enter |
| --- | --- |
| iOS simulator | `http://localhost:3000` |
| Android emulator | `http://10.0.2.2:3000` — the emulator's alias for your host machine; `localhost` there is the emulator itself |
| Physical device | `http://<your-machine-LAN-IP>:3000` (same Wi-Fi) |

Plain `http://` works on both because debug builds allow cleartext traffic; release builds do not.

> The backend server address is deliberately never hardcoded — every deployment has its own, so the user types it at login (for example `https://famlin.yourdomain.com`) and it is stored from then on. Setting `EXPO_PUBLIC_API_URL` in `mobile/.env` only preselects the API base URL for development; there is no implicit `localhost` fallback, so an unreachable server surfaces as an error instead of silently retargeting.
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
