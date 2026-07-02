---
sidebar_position: 2
---

# Server setup

This guide covers running Famlin **in production, for your family** — on a Synology NAS, a VPS, or any host with Docker. If you're working on Famlin's code and want to run it locally to develop against, see [Quick start](/developers/quick-start) in the Developers tab instead.

## Requirements

- Docker and Docker Compose (v2 CLI plugin, i.e. `docker compose`, not the standalone `docker-compose`).
- A domain or subdomain pointed at the server (e.g. `famlin.yourdomain.com`), if you want to expose Famlin outside your local network.
- A reverse proxy that can terminate TLS — Traefik, Nginx, Caddy, or your NAS's built-in reverse proxy all work.

Famlin ships as a single backend container (Fastify API + admin UI, served from the same process) plus a Postgres container. The mobile app talks to it over HTTPS; there's nothing else to run server-side.

## 1. Get the files onto the server

`docker-compose.yml` runs the pre-built backend image from `ghcr.io/timvanonckelen/famlin`, so you only need the compose file itself — no source checkout required:

```bash
mkdir famlin && cd famlin
curl -O https://raw.githubusercontent.com/TimVanOnckelen/famlin/main/docker-compose.yml
```

(Or clone the repository if you'd rather have the whole history, or want to [build the image from source](./maintenance#building-from-source-instead) instead.)

For reference — or to paste directly if your setup wants compose content rather than a URL (e.g. Synology Container Manager's manual-entry mode, see below) — here's the file as of this writing. It pulls `famlin-backend` straight from `ghcr.io/timvanonckelen/famlin`, no build step involved:

```yaml title="docker-compose.yml"
services:
  famlin-db:
    image: postgres:16-alpine
    container_name: famlin-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: famlin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: famlin
    volumes:
      - famlin-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U famlin -d famlin"]
      interval: 5s
      timeout: 5s
      retries: 5

  famlin-backend:
    # Pre-built, versioned image published on every GitHub release.
    # Pin FAMLIN_VERSION (e.g. 1.2.0) instead of `latest` for deliberate updates.
    image: ghcr.io/timvanonckelen/famlin:${FAMLIN_VERSION:-latest}
    container_name: famlin-backend
    restart: unless-stopped
    depends_on:
      famlin-db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://famlin:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@famlin-db:5432/famlin?schema=public
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      TRUST_PROXY: ${TRUST_PROXY:-false}
    volumes:
      - famlin-uploads:/app/uploads
    ports:
      - "3000:3000"

volumes:
  famlin-db-data:
  famlin-uploads:
```

This always matches the canonical [`docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml) in the repository root — if the two ever disagree, the repo file is the source of truth.

## 2. Configure environment variables

Runtime configuration in Famlin is split in two:

- **Startup env vars** (`.env`, read once when the container starts): `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `TRUST_PROXY`. `docker-compose.yml` also reads `POSTGRES_PASSWORD` and `JWT_SECRET` directly from `.env` to configure the database container and build `DATABASE_URL` for you.
- **Everything else** (OIDC/SSO, allowed emails, SMTP, push notifications): stored in the database and managed later from `/admin` — see [Admin configuration](./admin-configuration).

Create a `.env` file next to `docker-compose.yml`:

```bash title=".env"
JWT_SECRET=change-this-to-a-secure-random-string-with-at-least-32-characters
POSTGRES_PASSWORD=change-this-to-a-secure-random-password
TRUST_PROXY=false
```

- `JWT_SECRET` — generate a long random value, e.g. `openssl rand -base64 48`. Anyone with this value can forge login tokens, so keep it private and never commit it.
- `POSTGRES_PASSWORD` — generate a random password (e.g. `openssl rand -base64 24`); Postgres is not exposed outside the Docker network, but don't leave it at a guessable default.
- `TRUST_PROXY` — leave `false` unless Famlin sits behind a reverse proxy (see [step 4](#4-put-a-reverse-proxy-in-front)); see the note there before flipping it on.
- `DATABASE_URL` is derived automatically by `docker-compose.yml` from `POSTGRES_PASSWORD` — you don't need to set it yourself unless you're pointing at an external Postgres instance (see [Using an external database](./maintenance#using-an-external-database)), in which case set it directly on the `famlin-backend` service instead of via `.env`.
- Leave `PORT=3000` as-is unless you have a specific reason to change it; `NODE_ENV=production` is already set in `docker-compose.yml`.

## 3. Start the stack

Use `docker-compose.yml` on its own — **do not** include `docker-compose.override.yml` in production; that file exists only for local hot-reload development and is picked up automatically by plain `docker compose up`, so be explicit about which file(s) you use:

```bash
docker compose -f docker-compose.yml up -d
```

This starts:

- `famlin-db` — Postgres 16, with a named volume `famlin-db-data` for persistence.
- `famlin-backend` — the API + admin UI, pulled from `ghcr.io/timvanonckelen/famlin`. On container start it automatically runs `prisma migrate deploy` before starting the server, so schema migrations are applied on every deploy/restart.

Check that both containers are healthy:

```bash
docker compose ps
docker compose logs -f famlin-backend
```

The API is now listening on port 3000 inside the Docker network (and on the host, per the `ports:` mapping in `docker-compose.yml`).

## Example: Synology NAS with Container Manager (no SSH required)

Everything above (steps 1–3) can also be done entirely through Synology's **Container Manager** app (DSM 7.2+), if you'd rather not use SSH or the `docker compose` CLI directly. This walks through the same setup via the GUI; once your project is running, skip to [step 4](#4-put-a-reverse-proxy-in-front) below.

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

Once the containers are running, continue to step 4 below for the reverse proxy — Synology's own **Control Panel → Login Portal → Reverse Proxy** is a natural fit since you're already in DSM (see the note at the end of that section).

## 4. Put a reverse proxy in front

Famlin does not terminate TLS itself. Point your reverse proxy at the container's port 3000 and let it handle HTTPS. A few notes regardless of which proxy you use:

- Forward the whole path space (`/`, `/api`, `/admin`, `/uploads`) to the backend — everything is served from the one Fastify process.
- Uploaded photos require a valid session or media token to fetch (see [Security](./security)), not just a correct URL, so your proxy doesn't need to restrict access to `/uploads/` itself — just don't cache responses across different users/sessions.
- Both the mobile app and the admin UI do OIDC's Authorization Code + PKCE flow directly against your identity provider, then hand the resulting token to the backend — no proxy-level auth or special CORS handling is needed beyond passing requests through as-is.
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
        client_max_body_size 25m; # photo uploads
    }
}
```

</details>

If you're on a Synology NAS, the built-in **Control Panel → Login Portal → Reverse Proxy** works the same way: forward `famlin.yourdomain.com` (HTTPS) to `localhost:3000` (HTTP).

## Next steps

Once the stack is up and reachable over HTTPS, head to [Admin configuration](./admin-configuration) to log in, set a login method, and lock down who can sign up.
