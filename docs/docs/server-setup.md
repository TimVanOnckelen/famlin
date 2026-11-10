---
sidebar_position: 2
---

# Server setup

:::tip New to self-hosting?
[Choose your installation](./choose-installation.md) points you to the easiest option for what you have. On a Synology NAS, you can also follow the dedicated [Container Manager guide](./install-synology.md) without using SSH.
:::

This guide covers running Famlin **in production, for your family** with Docker Compose. If you're working on Famlin's code, see [Quick start](/developers/quick-start) in the Developers tab instead.

## Requirements

- Docker and Docker Compose v2 (`docker compose`, not the standalone `docker-compose`).
- An `x86_64` (`amd64`) or `arm64` host. The published multi-arch image works on regular servers, Raspberry Pi 4/5 (64-bit OS), ARM NAS devices, Apple Silicon Macs, and ARM cloud VMs.
- For access outside your local network, a domain or subdomain and one of the HTTPS options in [step 4](#4-set-up-https).

Famlin runs as one backend container—Fastify API, family web app at `/`, and admin UI at `/admin`—plus a Postgres container.

## 1. Get the files onto the server

The compose file uses the pre-built image from `ghcr.io/timvanonckelen/famlin`, so you don't need a source checkout:

```bash
mkdir famlin && cd famlin
curl -O https://raw.githubusercontent.com/TimVanOnckelen/famlin/main/docker-compose.yml
```

Every [GitHub release](https://github.com/TimVanOnckelen/famlin/releases) also has a `docker-compose.yml` pinned to that version, plus `env.example`. Use those if you'd rather install a specific version than track `latest`. The repository's [`docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml) is always the source of truth; to build the image yourself instead, see [Building from source](./maintenance.md#building-from-source-instead).

## 2. Configure environment variables

**You don't need a `.env` file to get started.** On first start, Famlin generates and stores both secrets for you:

- The **JWT secret**, which signs login tokens, lives in the `famlin-data` volume. Keep it with your backups; if it is lost, everyone simply needs to log in again.
- The **database password** lives in the `famlin-db-secret` volume. Keep that volume together with the database volume: deleting only the secret volume makes the existing database reject the newly generated password.

Create a `.env` next to `docker-compose.yml` only for values you want to choose yourself:

```bash title=".env (all optional)"
# JWT_SECRET=...
# POSTGRES_PASSWORD=...
TRUST_PROXY=false
```

- `JWT_SECRET` overrides the generated secret. Use a long random value, for example `openssl rand -base64 48`, and keep it private.
- `POSTGRES_PASSWORD` sets the database password on first initialization only. Changing it later does not change an existing database's password.
- `TRUST_PROXY` stays `false` unless Famlin is behind a reverse proxy. See [Your own reverse proxy](#option-c-your-own-reverse-proxy) before enabling it.

Everything else—login methods, allowed emails, notifications, media integrations, branding, and backups—is configured later in `/admin`; see [Admin configuration](./admin-configuration.md).

<details>
<summary>Advanced startup variables</summary>

- `DATABASE_URL` is built automatically from the bundled database settings and stored password. Set it directly on the `famlin-backend` service only when [using an external database](./maintenance.md#using-an-external-database).
- `PORT=3000` and `NODE_ENV=production` are already set in the compose file.
- `UPLOADS_DIR`, `DATA_DIR`, and `BACKUPS_DIR` default to the container paths used by the `famlin-uploads`, `famlin-data`, and `famlin-backups` volumes. Normally, mount storage at those paths instead of changing the variables. `DATA_DIR` is always local disk, even when media uses S3.
- `STORAGE_DRIVER`, `S3_*`, and `STORAGE_FALLBACK_*` configure media storage and online migration. Leave them unset for the default local volume; see [Storage](./storage.md).

</details>

## 3. Start the stack

Use the production compose file explicitly—`docker-compose.override.yml` is only for local development:

```bash
docker compose -f docker-compose.yml up -d
```

This starts Postgres and the Famlin backend. The backend applies database migrations automatically on every start.

Check that the database and backend are healthy:

```bash
docker compose ps
docker compose logs -f famlin-backend
```

The backend healthcheck returns success only when the database is reachable and the uploads volume is writable. If it fails, check the backend logs for the specific problem. Famlin listens on port `3000`; both long-running containers rotate their logs to prevent them filling the disk.

## 4. Set up HTTPS

Famlin does not terminate TLS itself, and the mobile apps need an `https://` address. Pick one option:

| | Needs | Good when |
| --- | --- | --- |
| **A. Caddy** (bundled) | A domain, ports 80 and 443 reachable from the internet | You have a VPS, or can forward ports on your router |
| **B. Cloudflare Tunnel** (bundled) | A domain on Cloudflare (free plan is fine) | Your ISP blocks ports or uses CGNAT, or you don't want to open ports |
| **C. Your own reverse proxy** | Whatever you already run | You already have Traefik/Nginx/Caddy, or a NAS reverse proxy |

### Option A: automatic HTTPS with Caddy

The Caddy overlay gets and renews a free Let's Encrypt certificate, stops publishing Famlin's port 3000 directly, and sets `TRUST_PROXY=true` for you.

1. **DNS:** create an `A` record (and `AAAA` if you have IPv6) for your domain, pointing at the server's public IP. A free [DuckDNS](https://www.duckdns.org) name works too.
2. **Ports:** allow TCP **80** and **443** through the host firewall and router; allow UDP 443 as well for HTTP/3. Port 80 is needed for the certificate challenge.
3. **Files:** download `docker-compose.caddy.yml` and `Caddyfile` from your [GitHub release](https://github.com/TimVanOnckelen/famlin/releases), next to `docker-compose.yml`.
4. **Start:**

   ```bash
   echo 'FAMLIN_DOMAIN=famlin.yourdomain.com' >> .env
   # Optional: certificate expiry notices from Let's Encrypt
   echo 'ACME_EMAIL=you@example.com' >> .env
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

`FAMLIN_DOMAIN` is required. Use the same `-f` flags for every later Compose command, or set `COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml` in `.env`. The overlay needs Docker Compose v2.24 or newer.

Open `https://famlin.yourdomain.com/admin` and finish setup. Certificate issuance can make the first start slightly slower. Keep the `caddy-data` volume so repeated re-creation doesn't hit Let's Encrypt rate limits. Caddy supports Famlin's large uploads and video range requests without extra limits.

<details>
<summary>Caddy troubleshooting</summary>

- **Certificate errors:** check `docker compose -f docker-compose.yml -f docker-compose.caddy.yml logs caddy`. Usually DNS doesn't point at this server yet, or ports 80/443 aren't reachable. Caddy retries after you fix the problem.
- **Port 80 blocked or CGNAT:** use [Cloudflare Tunnel](#option-b-cloudflare-tunnel) instead.
- **Port 80 or 443 already in use:** stop or move the other web server, or use [your own reverse proxy](#option-c-your-own-reverse-proxy).

</details>

### Option B: Cloudflare Tunnel

A Cloudflare Tunnel makes an outbound connection from your server, so you open no ports and manage no certificates, and it works behind CGNAT. Cloudflare terminates TLS and therefore sees your traffic; large uploads are capped on the free plan. Follow the step-by-step [Cloudflare Tunnel guide](./cloudflare-tunnel.md).

### Option C: your own reverse proxy

Point your reverse proxy at the container's port `3000` and let it handle HTTPS.

- Forward the whole path space (`/`, `/api`, `/admin`, `/uploads`) to the backend.
- Don't cache `/uploads/` responses across users or sessions; uploaded media requires a valid session or media token.
- Pass requests through without proxy-level authentication or special CORS handling.
- **Raise the request body limit and upload timeout.** Famlin accepts files up to 200 MB, while Nginx defaults to only 1 MB. Set at least the largest file you want to allow (`client_max_body_size` on Nginx, `maxRequestBodyBytes` on Traefik; Caddy has no default limit) and allow enough time for slow mobile uploads.
- **Set `TRUST_PROXY=true`** in `.env`. The proxy must set, not append to, `X-Forwarded-Proto` and `X-Forwarded-Host`; Famlin uses these for correct invite and login URLs. Don't enable `TRUST_PROXY` on a directly exposed server.

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

Add labels to the `famlin-backend` service in a compose override:

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
        client_max_body_size 200m;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

</details>

On Synology, use **Control Panel → Login Portal → Reverse Proxy** to forward your HTTPS hostname to `localhost:3000` over HTTP.

## Next steps

Open `/admin`. A fresh database shows a one-time setup screen for your admin account, followed by a setup wizard for your first family, invitations, the mobile-app QR code, and backups. Skipped items remain on the dashboard's **Getting started** checklist until completed or dismissed.

Then follow [Admin configuration](./admin-configuration.md) to choose a login method and control who can sign up. Family members can use the web app at your server's root URL or connect the mobile app.

By default, photos and videos live on the `famlin-uploads` volume. For another disk, NAS share, or S3-compatible bucket, see [Storage](./storage.md). To run a read-only sample deployment instead, see [Demo instance](/developers/demo-instance).
