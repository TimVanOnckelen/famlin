---
sidebar_position: 1
---

# Choose your installation

Famlin runs on a computer you control, so the first question is simple: **what do you have today?** Pick the row that fits and follow that guide. Every path ends in the same place, described [below](#after-the-install-is-running).

## What do you have?

| If you have... | Follow | 
| --- | --- |
| An **Umbrel** or **CasaOS / ZimaOS** home server | [Install on Umbrel or CasaOS](./install-umbrel-casaos) |
| **Home Assistant** (OS or Supervised) | [Install as a Home Assistant add-on](./install-home-assistant) |
| A **Synology NAS** | [Synology with Container Manager](./server-setup#example-synology-nas-with-container-manager-no-ssh-required) (no command line needed) |
| **Nothing yet**, and you're happy to rent a small server | [Famlin on a small server in 10 minutes](./install-vps) |
| A server or PC and you're **comfortable with Docker** | [Server setup](./server-setup) (Docker Compose) |

Not sure? If you have no spare hardware, rent a small server. If you already own a home server or NAS, use it.

## At a glance

| Path | Effort | Cost | Best for | How family reaches it from outside |
| --- | --- | --- | --- | --- |
| Umbrel / CasaOS | A few clicks | The box you already own | Home-server hobbyists | The platform's remote access, or a [Cloudflare Tunnel](./cloudflare-tunnel) |
| Home Assistant | A few clicks | The box you already own | Existing Home Assistant users | Home Assistant's remote access, or a [Cloudflare Tunnel](./cloudflare-tunnel) |
| Synology NAS | About 20 minutes | The NAS you already own | NAS owners who prefer a GUI | Synology's reverse proxy, or a [Cloudflare Tunnel](./cloudflare-tunnel) |
| Rented server | About 10 minutes | A few euros a month | Anyone without hardware | Built in: the installer sets up HTTPS for you |
| Docker Compose | About 15 minutes | Whatever you run it on | People who know Docker | Caddy overlay, Cloudflare Tunnel or your own reverse proxy |

## How will my family reach it from outside?

At home, everyone on your Wi-Fi can already open Famlin. For grandparents, cousins and phones on mobile data, the server needs a safe public address (`https://famlin.yourdomain.com`). There are three common ways:

- **Caddy (bundled).** Famlin ships an optional Caddy setup that gets a free HTTPS certificate for your own domain automatically. You open ports 80 and 443 on your router (or use a rented server, where they're already open). Simplest on a server with a public IP.
- **Cloudflare Tunnel.** Your server makes an outbound connection to Cloudflare, so you open no ports at all and your home IP stays hidden. Best behind a home router or CGNAT. See [Cloudflare Tunnel](./cloudflare-tunnel).
- **Your platform's remote access.** Umbrel, CasaOS, Home Assistant and Synology each offer their own way to reach the box from outside. Fine if you already use it, as long as it ends in an `https://` address.

The mobile app needs an HTTPS address, so don't skip this step if family lives elsewhere. Details are in [step 4 of Server setup](./server-setup#4-set-up-https).

## After the install is running

The ending is the same on every path:

1. **Open your server's setup screen** in a browser (for example `https://famlin.yourdomain.com/admin`). A fresh install has no users, so you see a one-time setup wizard.
2. **Let the wizard create your family**: your admin account and your first family.
3. **Invite people**, or connect phones with a QR code. See [Inviting family members](./inviting-family).

## Keep it safe

- **Updates.** Famlin shows admins a notice when a new version is out. Updating is a pull and restart (or one click on Umbrel, CasaOS and Home Assistant). See [Updating](./maintenance#staying-up-to-date).
- **Backups are on by default.** Scheduled backups of the database and your photos run automatically. See [Backups](./maintenance#backups).
- **Copy backups off the machine.** A backup on the same disk doesn't survive a dead disk or a stolen NAS. Follow [Keep backups off the machine](./maintenance#keep-backups-off-the-machine).
