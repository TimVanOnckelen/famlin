---
sidebar_position: 1.5
---

# Famlin on a 4 euro server in 10 minutes

The quickest way to run Famlin for your family: rent a small server, point a domain at it and run **one command**. The installer sets up Docker, automatic HTTPS and automatic updates for you. You never touch a config file.

Prefer to set things up by hand, or run Famlin on a NAS or Raspberry Pi? See [Server setup](./server-setup).

## What you need

- A small VPS running **Debian 12/13 or Ubuntu 22.04/24.04**. 1 vCPU and 2 GB RAM is enough for a family. Hetzner's CX22 (x86) or CAX11 (Arm) cost around 4 euro a month; any provider works.
- A **domain name** (or a free subdomain from [DuckDNS](https://www.duckdns.org)). Without one you can still try Famlin on plain `http://<server-ip>:3000` using `local` mode, but the mobile apps and photo uploads work best over HTTPS.

## 1. Create the server

At your provider, create a server with a Debian or Ubuntu image and add your SSH key. Note its public IPv4 address. Open ports **22, 80 and 443** if the provider has a firewall (Hetzner Cloud Firewalls are off by default).

## 2. Point your domain at it

Create an **A record** for the name you want (for example `famlin.example.com`) with the server's IPv4 address. With DuckDNS, create a subdomain and paste the IP. The installer checks this and warns you if the name does not resolve to the server yet; Let's Encrypt can only issue the certificate once it does.

## 3. Run the installer

SSH into the server (`ssh root@<server-ip>`) and run:

```sh
curl -fsSL https://famlin.app/install.sh | sh
```

It asks how people will reach Famlin:

| Mode | What it does |
| --- | --- |
| `caddy` (recommended) | Automatic HTTPS on your domain via Caddy and Let's Encrypt. Asks for the domain and an optional email. |
| `tunnel` | [Cloudflare Tunnel](./cloudflare-tunnel): no open ports. Asks for the tunnel token. |
| `local` | Plain `http://<ip>:3000`, no proxy. For a home network or testing. |

When it finishes (a few minutes, mostly downloading images) it prints the address to open.

### Read it first

Piping a script into a shell means trusting it. If you would rather read it first:

```sh
curl -fsSLO https://famlin.app/install.sh
less install.sh
sh install.sh
```

The script is short, commented and lives in the repository as [`scripts/install.sh`](https://github.com/TimVanOnckelen/famlin/blob/main/scripts/install.sh). `sh install.sh --dry-run` prints every step without changing anything.

### Without questions

Everything can be passed as flags, for automation:

```sh
curl -fsSL https://famlin.app/install.sh | sh -s -- --yes \
  --mode caddy --domain famlin.example.com --email you@example.com
```

| Flag | Meaning |
| --- | --- |
| `--mode caddy\|tunnel\|local` | How Famlin is reached. |
| `--domain`, `--email` | Caddy mode: your domain and an optional Let's Encrypt contact. |
| `--tunnel-token` | Tunnel mode: the Cloudflare tunnel token. |
| `--dir PATH` | Install directory (default `/opt/famlin`). |
| `--version vX.Y.Z` | Install a specific release and pin the image to it (no automatic version changes). |
| `--channel latest\|release` | `latest` (default): the image tag is `latest`, so updates follow new releases. `release`: stay on the release that was downloaded until you re-run the installer. |
| `--no-auto-update` | Do not install the daily update timer. |
| `--yes` | Never ask; use flags, values already in `.env`, and defaults. |
| `--dry-run` | Show what would happen, change nothing. |

## 4. Create your admin account

Open `https://<your-domain>/admin`. A fresh server shows a one-time setup screen: create the first admin account, then follow [After the first start](./admin-configuration) to pick how people sign in, create your family and [invite everyone](./inviting-family).

## What gets installed

Everything lives in `/opt/famlin`: the release's `docker-compose*.yml` files, the `Caddyfile` and a `.env` that records your choices (`FAMLIN_MODE`, `FAMLIN_DOMAIN`, `COMPOSE_FILE`, ...). Because `.env` sets `COMPOSE_FILE`, plain `docker compose` commands in that folder automatically use the right set of files:

```sh
cd /opt/famlin
docker compose ps
docker compose logs -f famlin-backend
```

The compose files are replaced on every run of the installer, so put your own settings in `.env` (see [Server setup](./server-setup#2-configure-environment-variables)); the installer only edits its own keys. Database password and login secret are generated automatically and stored in Docker volumes.

## Updates

Unless you passed `--no-auto-update`, a systemd timer (`famlin-update.timer`, daily with a random delay) runs `docker compose pull && docker compose up -d` in `/opt/famlin`. With the default `latest` channel that moves you to each new release automatically, usually without you noticing. Check it with `systemctl list-timers famlin-update.timer`.

Trade-off: automatic updates mean a release with a breaking change (it is always called out in the release notes) is applied without you reading them. The admin UI shows an update notice, and you can pick a different style at any time:

- Reviewed updates: re-run the installer with `--channel release` (or `--version vX.Y.Z`) and `--no-auto-update`, then update by re-running the installer with a newer `--version` when you have read the notes.
- Update right now: `cd /opt/famlin && docker compose pull && docker compose up -d`.

Back up before big upgrades: see [Maintenance](./maintenance).

## Re-running, repairing, uninstalling

Re-running the installer is safe: it keeps your `.env` choices (they become the defaults), refreshes the compose files and restarts the stack. It never deletes volumes, so your posts and photos stay.

To remove Famlin **but keep your data**:

```sh
cd /opt/famlin && docker compose down
sudo systemctl disable --now famlin-update.timer
sudo rm /etc/systemd/system/famlin-update.{service,timer}
```

To also **delete all data permanently** (database, photos, backups, certificates), add `-v` to `docker compose down`. There is no undo.
