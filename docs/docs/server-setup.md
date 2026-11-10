---
sidebar_position: 2
---

# Server setup

:::tip New to self-hosting?
This page is the manual Docker Compose route. If you're not sure which way to install Famlin, start with [Choose your installation](./choose-installation.md): it points you to the easiest option for what you have (Umbrel, Home Assistant, Synology, or a rented server).
:::

This guide covers running Famlin **in production, for your family** — on a Synology NAS, a VPS, or any host with Docker. If you're working on Famlin's code and want to run it locally to develop against, see [Quick start](/developers/quick-start) in the Developers tab instead.

## Requirements

- Docker and Docker Compose (v2 CLI plugin, i.e. `docker compose`, not the standalone `docker-compose`).
- An `x86_64` (`amd64`) or `arm64` host. The published image is multi-arch, so the same `ghcr.io/timvanonckelen/famlin` tag runs natively on a regular server as well as on a Raspberry Pi 4/5 (64-bit OS), an ARM-based NAS, an Apple Silicon Mac, or an ARM cloud VM — Docker picks the right variant automatically.
- A domain or subdomain pointed at the server (e.g. `famlin.yourdomain.com`), if you want to expose Famlin outside your local network.
- A way to serve HTTPS — the bundled Caddy or Cloudflare Tunnel setups below need nothing extra; otherwise a reverse proxy that can terminate TLS (Traefik, Nginx, Caddy, or your NAS's built-in reverse proxy).

Famlin ships as a single backend container (Fastify API + the family-facing web app at `/` + the admin UI at `/admin`, all served from the same process) plus a Postgres container. Family members can use the web app in a browser or the mobile app over HTTPS; there's nothing else to run server-side.

## 1. Get the files onto the server

`docker-compose.yml` runs the pre-built backend image from `ghcr.io/timvanonckelen/famlin`, so you only need the compose file itself — no source checkout required:

```bash
mkdir famlin && cd famlin
curl -O https://raw.githubusercontent.com/TimVanOnckelen/famlin/main/docker-compose.yml
```

Every [GitHub release](https://github.com/TimVanOnckelen/famlin/releases) also carries a `docker-compose.yml` pinned to that exact version, plus `env.example`, as downloadable assets — handy if you'd rather install a specific version than track `latest`.

(Or clone the repository if you'd rather have the whole history, or want to [build the image from source](./maintenance.md#building-from-source-instead) instead.)

For reference — or to paste directly if your setup wants compose content rather than a URL (e.g. Synology Container Manager's manual-entry mode, see below) — here's the file as of this writing. It pulls `famlin-backend` straight from `ghcr.io/timvanonckelen/famlin`, no build step involved:

```yaml title="docker-compose.yml"
services:
  # One-shot helper: stores the database password in a volume on first run
  # (your POSTGRES_PASSWORD if set, otherwise a random one). Never overwrites.
  famlin-init:
    image: alpine:3.20
    container_name: famlin-init
    restart: "no"
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-}
    volumes:
      - famlin-db-secret:/secrets
    command:
      - sh
      - -c
      - |
        set -e
        f=/secrets/db_password
        if [ ! -s "$$f" ]; then
          umask 077
          if [ -n "$$POSTGRES_PASSWORD" ]; then
            printf %s "$$POSTGRES_PASSWORD" > "$$f"
          else
            head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$$f"
          fi
        fi
        chmod 444 "$$f"

  famlin-db:
    image: postgres:16-alpine
    container_name: famlin-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: famlin
      POSTGRES_PASSWORD_FILE: /run/famlin-secrets/db_password
      POSTGRES_DB: famlin
    depends_on:
      famlin-init:
        condition: service_completed_successfully
    volumes:
      - famlin-db-data:/var/lib/postgresql/data
      - famlin-db-secret:/run/famlin-secrets:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U famlin -d famlin"]
      interval: 5s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  famlin-backend:
    # Pre-built, versioned image published on every GitHub release.
    # Pin FAMLIN_VERSION (e.g. 1.2.0) instead of `latest` for deliberate updates.
    image: ghcr.io/timvanonckelen/famlin:${FAMLIN_VERSION:-latest}
    container_name: famlin-backend
    restart: unless-stopped
    depends_on:
      famlin-init:
        condition: service_completed_successfully
      famlin-db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL:-}
      POSTGRES_PASSWORD_FILE: /run/famlin-secrets/db_password
      JWT_SECRET: ${JWT_SECRET:-}
      TRUST_PROXY: ${TRUST_PROXY:-false}
      # Media backend and optional previous storage for online migration —
      # see the Storage page. Leave unset for the default local volume.
      STORAGE_DRIVER: ${STORAGE_DRIVER:-local}
      S3_BUCKET: ${S3_BUCKET:-}
      S3_ENDPOINT: ${S3_ENDPOINT:-}
      S3_REGION: ${S3_REGION:-us-east-1}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:-}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-}
      S3_SESSION_TOKEN: ${S3_SESSION_TOKEN:-}
      S3_PREFIX: ${S3_PREFIX:-}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-false}
      STORAGE_FALLBACK_DRIVER: ${STORAGE_FALLBACK_DRIVER:-}
      STORAGE_FALLBACK_UPLOADS_DIR: ${STORAGE_FALLBACK_UPLOADS_DIR:-/app/uploads}
      STORAGE_FALLBACK_S3_BUCKET: ${STORAGE_FALLBACK_S3_BUCKET:-}
      STORAGE_FALLBACK_S3_ENDPOINT: ${STORAGE_FALLBACK_S3_ENDPOINT:-}
      STORAGE_FALLBACK_S3_REGION: ${STORAGE_FALLBACK_S3_REGION:-us-east-1}
      STORAGE_FALLBACK_S3_ACCESS_KEY_ID: ${STORAGE_FALLBACK_S3_ACCESS_KEY_ID:-}
      STORAGE_FALLBACK_S3_SECRET_ACCESS_KEY: ${STORAGE_FALLBACK_S3_SECRET_ACCESS_KEY:-}
      STORAGE_FALLBACK_S3_SESSION_TOKEN: ${STORAGE_FALLBACK_S3_SESSION_TOKEN:-}
      STORAGE_FALLBACK_S3_PREFIX: ${STORAGE_FALLBACK_S3_PREFIX:-}
      STORAGE_FALLBACK_S3_FORCE_PATH_STYLE: ${STORAGE_FALLBACK_S3_FORCE_PATH_STYLE:-false}
    volumes:
      - famlin-uploads:/app/uploads
      - famlin-data:/app/data
      - famlin-db-secret:/run/famlin-secrets:ro
      - famlin-backups:/app/backups
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s
    stop_grace_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  famlin-db-data:
  famlin-db-secret:
  famlin-data:
  famlin-uploads:
  famlin-backups:
```

This always matches the canonical [`docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml) in the repository root — if the two ever disagree, the repo file is the source of truth.

## 2. Configure environment variables

Runtime configuration in Famlin is split in two:

- **Startup env vars** (`.env`, read once when the container starts): `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `TRUST_PROXY`, the optional `UPLOADS_DIR`, `BACKUPS_DIR` and `DATA_DIR`, and the optional media storage settings (`STORAGE_DRIVER`, `S3_*`, `STORAGE_FALLBACK_*`, see [Storage](./storage.md)). `docker-compose.yml` also reads `POSTGRES_PASSWORD` and `JWT_SECRET` from `.env` when you set them.
- **Everything else** (OIDC/SSO, allowed emails, SMTP, push notifications, media integrations, branding, backups): stored in the database and managed later from `/admin` — see [Admin configuration](./admin-configuration.md).

**You don't need a `.env` file to get started.** With none, `docker compose up -d` generates the two secrets for you on first start and keeps them in Docker volumes:

- The **JWT secret** (signs login tokens) is generated once and stored at `/app/data/secrets/jwt_secret` in the `famlin-data` volume (file mode `0600`; the value is never logged). Back up `famlin-data` along with your database. If you lose it, Famlin simply generates a new one and everyone has to log in again; nothing else is affected.
- The **database password** is generated by the one-shot `famlin-init` container and stored in the `famlin-db-secret` volume, which only the database and backend containers mount. Keep `famlin-db-secret` and the database volume together: if you delete the secret volume but keep the database volume (and have no `POSTGRES_PASSWORD` in `.env`), a new password is generated that the existing database won't accept. Either keep both volumes, or set `POSTGRES_PASSWORD` yourself.

Everything below is an optional override. Create a `.env` file next to `docker-compose.yml` only for the settings you want to choose yourself:

```bash title=".env (all optional)"
# JWT_SECRET=...
# POSTGRES_PASSWORD=...
TRUST_PROXY=false
```

- `JWT_SECRET` — optional; when set it always wins over the generated file. Generate a long random value, e.g. `openssl rand -base64 48`. Anyone with this value can forge login tokens, so keep it private and never commit it.
- `POSTGRES_PASSWORD` — optional; used by `famlin-init` as the database password the first time it runs. An existing installation that already has `POSTGRES_PASSWORD` in `.env` keeps working unchanged. Postgres only reads its password when the database is first created, so changing this later does not change the password of an existing database (the stored password file is never overwritten).
- `TRUST_PROXY` — leave `false` unless Famlin sits behind a reverse proxy (see [step 4](#option-c-your-own-reverse-proxy)); see the note there before flipping it on.
- `DATABASE_URL` is built automatically by the backend from `POSTGRES_HOST` (default `famlin-db`), `POSTGRES_PORT` (`5432`), `POSTGRES_USER` (`famlin`), `POSTGRES_DB` (`famlin`) and the stored password (`POSTGRES_PASSWORD` or the file named by `POSTGRES_PASSWORD_FILE`, URL-encoded) — you don't need to set it yourself unless you're pointing at an external Postgres instance (see [Using an external database](./maintenance.md#using-an-external-database)), in which case set it directly on the `famlin-backend` service instead of via `.env`.
- Leave `PORT=3000` as-is unless you have a specific reason to change it; `NODE_ENV=production` is already set in `docker-compose.yml`.
- `UPLOADS_DIR` — optional; where uploaded photos and videos are stored. Defaults to `uploads` next to the server, which is exactly where the `famlin-uploads` volume mounts, so leave it unset unless you deliberately store media elsewhere (and mount that path into the container). The backend test harness uses it to keep a test run off the real media volume.
- `DATA_DIR` — optional; where generated secrets are stored (`secrets/jwt_secret`). Defaults to `data` next to the server, which is where the `famlin-data` volume mounts. This is always local disk, never S3, whatever your [storage](./storage.md) driver.
- `BACKUPS_DIR` — optional; where [scheduled backups](./maintenance.md#scheduled-backups) write their database dumps and uploads mirror. Defaults to `backups` next to the server, which is where the `famlin-backups` volume mounts. To keep backups on another disk or NAS share, bind-mount that folder at `/app/backups` instead of changing this.
- `STORAGE_DRIVER`, `S3_*`, `STORAGE_FALLBACK_*` — optional; where uploaded media is stored. Leave them unset to keep media on the `famlin-uploads` volume. To store media in an S3-compatible bucket instead, or to move an existing installation, see [Storage](./storage.md).

## 3. Start the stack

Use `docker-compose.yml` on its own — **do not** include `docker-compose.override.yml` in production; that file exists only for local hot-reload development and is picked up automatically by plain `docker compose up`, so be explicit about which file(s) you use:

```bash
docker compose -f docker-compose.yml up -d
```

This starts:

- `famlin-db` — Postgres 16, with a named volume `famlin-db-data` for persistence.
- `famlin-backend` — the API, the family-facing web app (at `/`), and the admin UI (at `/admin`), pulled from `ghcr.io/timvanonckelen/famlin`. On container start it automatically runs `prisma migrate deploy` before starting the server, so schema migrations are applied on every deploy/restart.

Check that both containers are healthy:

```bash
docker compose ps
docker compose logs -f famlin-backend
```

`docker compose ps` should show both containers as `healthy` once startup (including migrations) finishes. `famlin-backend`'s healthcheck polls `GET /health`, which answers `200` only when the database is reachable and the uploads volume is writable, and `503` otherwise. The response never says which check failed; that's in `docker compose logs famlin-backend`. Both containers rotate their logs (3 × 10 MB each), so a long-running install doesn't slowly fill its disk.

The API is now listening on port 3000 inside the Docker network (and on the host, per the `ports:` mapping in `docker-compose.yml`).

## Example: Synology NAS with Container Manager (no SSH required)

Everything above (steps 1–3) can also be done entirely through Synology's **Container Manager** app (DSM 7.2+), if you'd rather not use SSH or the `docker compose` CLI directly. This walks through the same setup via the GUI; once your project is running, skip to [step 4](#option-c-your-own-reverse-proxy) below.

1. **Install Container Manager** from Package Center, if it isn't already installed.
2. **Create a shared folder for the project.** In **File Station**, create a folder such as `docker/famlin`. This is where the compose file will live.
3. **Upload the files.** From your computer, upload into that folder:
   - `docker-compose.yml` (from the repo root)
   - your filled-in `.env` file (see [step 2](#2-configure-environment-variables) above) — save it as `.env` directly inside `docker/famlin`, next to `docker-compose.yml`

   Drag-and-drop from Finder/Explorer into File Station works fine, or mount the NAS as an SMB share and copy the files over.
4. **Create the project.** Open Container Manager → **Project** → **Create**.
   - **Project name**: `famlin`
   - **Path**: browse to the folder from step 2 (e.g. `/docker/famlin`)
   - **Source**: select **Use existing `docker-compose.yml`** — Container Manager detects the file you already uploaded. (If your version of Container Manager instead prompts you to paste compose content, choose the option to point at a path rather than paste, so it also picks up the `.env` file next to it — but if you do need to paste, the [example above](#1-get-the-files-onto-the-server) is the exact content to use.)
5. **Confirm environment variables.** Container Manager reads a `.env` file sitting next to `docker-compose.yml` automatically, so nothing further is needed if you uploaded one in step 3. Double check `JWT_SECRET` and `DATABASE_URL` look right on the summary screen before continuing.
6. **Pull and start.** Click through **Next** to the summary, then **Done**. Container Manager pulls the Postgres image and the pre-built `famlin-backend` image from `ghcr.io/timvanonckelen/famlin`, then starts both containers — this can take a minute the first time.
7. **Verify it's running.** Open **Project → famlin**, switch to the **Container** tab, and confirm both `famlin-db` and `famlin-backend` show as running. Click `famlin-backend` → **Details → Log** and look for the `prisma migrate deploy` output completing without errors, followed by the server starting.

To update later: re-download `docker-compose.yml` if it changed, then in Container Manager select the project and use **Action → Build** (this pulls the latest images), followed by **Action → Start** — the GUI equivalent of `docker compose pull && docker compose up -d`.

Once the containers are running, continue to step 4 below for HTTPS — Synology's own **Control Panel → Login Portal → Reverse Proxy** is a natural fit since you're already in DSM (see the note at the end of that section).

## 4. Set up HTTPS

Famlin does not terminate TLS itself, and the mobile apps need an `https://` address. Pick one of three ways to get one:

| | Needs | Good when |
| --- | --- | --- |
| **A. Caddy** (bundled) | A domain, ports 80 and 443 reachable from the internet | You have a VPS, or can forward ports on your router |
| **B. Cloudflare Tunnel** (bundled) | A domain on Cloudflare (free plan is fine) | Your ISP blocks ports or uses CGNAT, or you don't want to open ports |
| **C. Your own reverse proxy** | Whatever you already run | You already have Traefik/Nginx/Caddy, or a NAS reverse proxy |

### Option A: automatic HTTPS with Caddy

The Caddy overlay adds a [Caddy](https://caddyserver.com) container that gets and renews a free Let's Encrypt certificate by itself, and stops publishing Famlin's port 3000 so everything goes through HTTPS. It sets `TRUST_PROXY=true` for you.

1. **DNS:** create an `A` record (and an `AAAA` record if you have IPv6) for your domain, e.g. `famlin.yourdomain.com`, pointing at the server's public IP. No domain? A free [DuckDNS](https://www.duckdns.org) name such as `myfamily.duckdns.org` works the same way: create it there and point it at your public IP.
2. **Ports:** make sure ports **80** and **443** (TCP; 443/UDP too, for HTTP/3) reach the server — open them in the host firewall and forward them on your router. Port 80 is needed for the certificate challenge.
3. **Files:** next to `docker-compose.yml`, put `docker-compose.caddy.yml` and `Caddyfile` — both are attached to every [GitHub release](https://github.com/TimVanOnckelen/famlin/releases) next to the version-pinned `docker-compose.yml`, and live in the repository root.
4. **Start:**

   ```bash
   echo 'FAMLIN_DOMAIN=famlin.yourdomain.com' >> .env
   # optional: certificate expiry notices from Let's Encrypt
   echo 'ACME_EMAIL=you@example.com' >> .env
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

   `FAMLIN_DOMAIN` is the only required setting; Compose refuses to start without it. Use the same `-f` flags for every later `docker compose` command (or set `COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml` in `.env`). The overlay needs Docker Compose v2.24 or newer.

Open `https://famlin.yourdomain.com/admin` and finish setup. The first start takes a few seconds longer while the certificate is issued. Certificates live in the `caddy-data` volume — keep it, or you can hit Let's Encrypt's rate limits after repeated re-creation.

Caddy applies no request body limit or short timeouts, so photo and video uploads (up to Famlin's own 200 MB per file) and long video streams work, and it passes `Range` requests through, which video playback needs.

**Troubleshooting**

- *Certificate errors or the browser shows a warning:* check `docker compose -f docker-compose.yml -f docker-compose.caddy.yml logs caddy`. Usually the DNS record doesn't point at this server yet (check with `dig famlin.yourdomain.com`), or port 80/443 isn't reachable from outside. Fix it and Caddy retries on its own. Let's Encrypt limits repeated failures, so wait a few minutes between attempts.
- *Port 80 is blocked by your ISP, or you are behind CGNAT* (your router's public IP differs from the one your ISP shows you): the certificate challenge can't work. Use [Option B](#option-b-cloudflare-tunnel) instead.
- *Port 80 or 443 already in use:* another web server on the host (Synology's DSM uses them) must be stopped or moved, or use Option C.

### Option B: Cloudflare Tunnel

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) makes an outbound connection from your server to Cloudflare, so you open no ports and manage no certificates, and it works behind CGNAT. The trade-off is that Cloudflare terminates TLS and therefore sees your traffic, and large uploads are capped on the free plan. Follow the step-by-step [Cloudflare Tunnel guide](./cloudflare-tunnel.md).

### Option C: your own reverse proxy

Point your reverse proxy at the container's port 3000 (published by `docker-compose.yml`) and let it handle HTTPS. A few notes regardless of which proxy you use:

- Forward the whole path space (`/`, `/api`, `/admin`, `/uploads`) to the backend — everything is served from the one Fastify process.
- Uploaded photos require a valid session or media token to fetch (see [Security](./security.md)), not just a correct URL, so your proxy doesn't need to restrict access to `/uploads/` itself — just don't cache responses across different users/sessions.
- The mobile app, the web app, and the admin UI all do OIDC's Authorization Code + PKCE flow directly against your identity provider, then hand the resulting token to the backend — no proxy-level auth or special CORS handling is needed beyond passing requests through as-is.
- **Raise the proxy's request body limit and upload timeout.** Famlin itself accepts uploads up to 200 MB per file (photos and videos), but most proxies cap request bodies far lower by default — Nginx allows just 1 MB, which silently rejects almost every phone photo. When the proxy cuts the upload off, the app can't tell why and shows the user a bare "Network Error", and nothing appears in the Famlin container's logs because the request never reached it. Set the limit to at least the largest file you want to allow (`client_max_body_size` on Nginx, `maxRequestBodyBytes` on Traefik's buffering middleware; Caddy has no limit by default), and make sure any read/send timeout is generous enough for a slow mobile upload.
- **Set `TRUST_PROXY=true`** in `.env` once Famlin is behind a reverse proxy, and make sure the proxy sets (not merely appends to) `X-Forwarded-Proto` and `X-Forwarded-Host` on every request it forwards — all the examples below do this. This is what lets Famlin build correct invite links and origin URLs; leaving it `false` behind a proxy, or `true` with no proxy in front, both produce wrong links.

<details>
<summary>Example: Caddy</summary>

```caddyfile
famlin.yourdomain.com {
  reverse_proxy localhost:3000
}
```

</details>

<details>
<summary>Example: Traefik (Docker labels)</summary>

Add labels to the `famlin-backend` service in a compose override, or in `docker-compose.yml` directly if you're not using Traefik's file-based dynamic config:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.famlin.rule=Host(`famlin.yourdomain.com`)"
  - "traefik.http.routers.famlin.tls.certresolver=letsencrypt"
  - "traefik.http.services.famlin.loadbalancer.server.port=3000"
```

</details>

<details>
<summary>Example: Nginx</summary>

```nginx
server {
    listen 443 ssl;
    server_name famlin.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        client_max_body_size 200m; # photo/video uploads — Famlin's own per-file limit
        proxy_request_buffering off; # stream the upload through instead of buffering it to disk first
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

</details>

If you're on a Synology NAS, the built-in **Control Panel → Login Portal → Reverse Proxy** works the same way: forward `famlin.yourdomain.com` (HTTPS) to `localhost:3000` (HTTP).

## Demo instance

Famlin includes a read-only demo mode for public showcases. It uses the same image but pre-seeds the database with sample data and blocks all mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) except login endpoints, so visitors can browse but cannot post, comment, upload, or modify anything.

### Run the demo locally

```bash
curl -O https://raw.githubusercontent.com/TimVanOnckelen/famlin/main/docker-compose.demo.yml
# Set a JWT secret and Postgres password, then start:
JWT_SECRET=your-jwt-secret POSTGRES_PASSWORD=your-db-password \
  docker compose -f docker-compose.demo.yml up -d
```

Log in with `admin@example.com` / `test123456` or `test@example.com` / `test123456` to browse the sample family.

The sample data is in English and covers every feature, so a visitor has something to look at everywhere: posts with photos, a milestone, a poll, an event with RSVPs, a trip with check-ins, a shared album, a Family Circle, a gift list with the draw done, the family chat, wiki pages, live stories and a Highlight, favorites, an "on this day" memory, and notifications for both demo accounts. The photos are simple illustrations the seed paints itself into the uploads directory (only the default local storage driver serves them from there); files that already exist are left alone, so on a host whose disk is wiped on restart, such as Cloud Run, they're repainted on every start. The live stories and the "on this day" memory are also refreshed on every start, since both only make sense relative to today. The seed only creates rows that don't exist yet, so an existing demo database keeps whatever it was seeded with before — to switch an older demo to the current sample data, empty its database (for the Compose demo: `docker compose -f docker-compose.demo.yml down -v`) and start it again.

While read-only mode is on, both login screens say the server is a demo and show the demo account — `test@example.com` on the web app, `admin@example.com` on `/admin` — with a button that fills it in. After signing in, a banner at the top of the web app and the admin panel keeps saying it's a demo, and any action the demo blocks (posting, commenting, reacting, saving a setting, …) shows a notice explaining that changes are disabled, instead of failing silently. Blocked writes are answered with a `403` whose body carries `"code": "READ_ONLY"`, so other clients can recognize them too.

:::warning Don't hand the demo instance to an app store reviewer
Read-only mode blocks every mutation except the login endpoints, account
deletion (`DELETE /api/auth/me`) included — so on the demo a reviewer can't
post, comment, or delete their account, which reads as both an incomplete app
and a missing account-deletion flow. Give App Review a normal, writable
instance and a **non-admin** account (`admin@example.com` is the seed's only
admin, and the last remaining admin deliberately can't delete itself).
:::

### Deploy on a free Google Cloud VM

The cheapest always-free option is a Compute Engine `e2-micro` instance in `us-central1`, `us-east1`, or `us-west1`:

1. Create a VM with the Container-Optimized OS or Debian/Ubuntu.
2. Install Docker and Docker Compose.
3. Download `docker-compose.demo.yml` and create an `.env` file with `JWT_SECRET` and `POSTGRES_PASSWORD`.
4. Open firewall port `3000` (or put a reverse proxy in front).
5. Run `docker compose -f docker-compose.demo.yml up -d`.

### Deploy on Google Cloud Run (free tier)

A read-only demo fits Cloud Run's free tier: it scales to zero between visits and gets an HTTPS `*.run.app` address. Cloud Run has no database of its own, so pair it with a free hosted Postgres such as [Neon](https://neon.tech) (use the direct connection string, not the `-pooler` one, with `?sslmode=require`). Create the service from the Famlin image with:

- **Container port** `3000`, **memory** `1 GiB`, **billing** request-based, **scaling** min `0` / max `1`, **authentication** public (read-only mode keeps it closed).
- **Command** `sh` with the two arguments `-c` and `npx prisma migrate deploy && node dist/prisma/seed.js && exec node dist/server.js`, so every start migrates and seeds before serving. Set these with `gcloud run services update <service> --command=sh --args="-c,<that line>"` — the console's argument field doesn't pass `-c` through reliably.
- **Variables** `DATABASE_URL`, `JWT_SECRET` (set it explicitly — a generated one would change on every cold start and sign everyone out), `READ_ONLY=true` and `TRUST_PROXY=true`.

Cloud Run can't pull from `ghcr.io` directly; the setup below adds an Artifact Registry remote repository that proxies it.

### Auto-deploy to Cloud Run

The `deploy-demo` job in `.github/workflows/docker-dev.yml` rolls a Cloud Run demo forward to every new `dev` image, right after it's published on a merge to `main`. It deploys by digest, so the demo runs exactly the build that run produced, and it only changes the image — the service keeps its variables, command and scaling. It's opt-in: without the repository variables below the job is skipped.

GitHub signs in to Google through Workload Identity Federation, so no key or password is stored anywhere. The federation only accepts `docker-dev.yml` itself, run by a push to this repository's `main` branch — not pull requests (forks included), not other workflows. Everything involved stays within free tiers. The one thing that can cost money is image storage beyond Artifact Registry's free 0.5 GB, which the cleanup policy below prevents by keeping only the two newest images.

One-time setup in Cloud Shell. Replace the first three values with your own; the remaining commands use them as they are.

```bash
PROJECT=famlin REGION=europe-west1 SERVICE=famlin-demo
GITHUB_REPO=TimVanOnckelen/famlin
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="famlin-demo-deployer@$PROJECT.iam.gserviceaccount.com"
```

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
```

```bash
gcloud artifacts repositories create ghcr --location="$REGION" --repository-format=docker --mode=remote-repository --remote-docker-repo=https://ghcr.io
```

```bash
cat > cleanup.json <<'EOF'
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "ANY"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies ghcr --location="$REGION" --policy=cleanup.json --no-dry-run
```

```bash
gcloud iam service-accounts create famlin-demo-deployer --display-name="Famlin demo deployer"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/run.developer --condition=None
gcloud iam service-accounts add-iam-policy-binding "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
```

The last line lets the deployer act as the service's runtime account. If your service runs as a different service account, use that one instead of the default compute account. Better still, give the demo its own runtime account with no roles at all (the demo only talks to its database): a deployer that may act as a broadly privileged account — the default compute account, or a Firebase admin account — could otherwise deploy code that runs with those rights.

:::warning The demo's admin account is public
Everyone can sign in as `admin@example.com`, and read-only mode still lets them read every admin page, including server settings. Never configure SMTP, SSO client secrets, Immich or storage credentials on a demo instance. Keep `DATABASE_URL` out of anything visitors can reach — it is only an environment variable of the Cloud Run service; for extra care, store it in Secret Manager and reference it from the service instead.
:::

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc famlin --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO' && assertion.ref=='refs/heads/main' && assertion.event_name=='push' && assertion.workflow_ref.startsWith('$GITHUB_REPO/.github/workflows/docker-dev.yml@')"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"
```

Print the values for GitHub:

```bash
cat <<EOF
DEMO_CLOUD_RUN_SERVICE=$SERVICE
DEMO_GCP_PROJECT=$PROJECT
DEMO_GCP_REGION=$REGION
DEMO_GCP_SERVICE_ACCOUNT=$SA
DEMO_GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/famlin
DEMO_IMAGE_REPOSITORY=$REGION-docker.pkg.dev/$PROJECT/ghcr
EOF
```

Add each line as a repository **variable** (not a secret — none of them is sensitive) under **Settings → Secrets and variables → Actions → Variables**. The next merge to `main` deploys the demo; the job's log shows the image it rolled out. To stop auto-deploying, delete `DEMO_CLOUD_RUN_SERVICE`.

A newer image doesn't rewrite the demo's database: the seed only adds rows that are missing. To reset the demo to the current sample data, empty the database and start a new revision.

## Next steps

Once the stack is up and reachable over HTTPS, open `/admin` — a fresh database has no users yet, so you'll land on a one-time setup screen to create your admin account — and the admin UI continues straight into a short **setup wizard** (also reachable later at `/admin/getting-started`). It walks you through naming your first family (you are added as its first member, with an optional accent color), creating an invite link you can copy or share, the QR code for connecting the mobile app, and a check that daily backups are on, with a reminder to copy them off the machine. Every step can be skipped, and your place is remembered if you leave. Anything you skip stays on a **Getting started** checklist on the dashboard (a family exists, you are in it, someone is invited, backups are on) until it is complete or you dismiss it. Then head to [Admin configuration](./admin-configuration.md) to set a login method and lock down who can sign up. After that, family members can sign in at the root URL (`https://famlin.yourdomain.com`) with the web app, or use the mobile app.

### Optional: where media is stored

By default, uploaded photos and videos live on the `famlin-uploads` volume. To put them on another disk, on a NAS share or in an S3-compatible bucket (AWS S3, MinIO, Garage, …), see [Storage](./storage.md).
