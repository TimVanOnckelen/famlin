# Famlin add-on

## First start

1. Install and start the add-on. The first start takes a minute (database setup
   and migrations); watch the Log tab.
2. Click **Open Web UI** (or browse to `http://<home-assistant>:3000/admin`).
3. Create the first administrator account on the setup screen.
4. Follow https://famlin.app/docs/ to create a family and invite members.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `trust_proxy` | `false` | Turn on only when Famlin is reached through a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) that sets `X-Forwarded-*` headers. Needed so invite links and logins use your public address. Leave off for direct access. |

## Where your data lives

Everything is in the add-on's `/data` folder, so a normal Home Assistant backup
contains it all: the PostgreSQL database, uploaded photos and videos, Famlin's
scheduled backups and the generated secrets. The add-on is stopped while a
backup is made ("cold" backups) so the database files are consistent.

For a second safety net, enable scheduled backups in the Famlin admin page
(Server settings, Backups). They are written inside `/data/backups` as well.

The bundled database is PostgreSQL 16. Updating the add-on never changes the
major version on its own.

## Reaching Famlin from outside your home

Family members use the phone apps away from home, so the server needs a normal
public HTTPS address. This add-on deliberately does not use Home Assistant
ingress: the apps and invite links need a plain URL, which ingress cannot give.
Nabu Casa remote access only forwards Home Assistant itself, not other ports.

Good options:

- The **Cloudflared** add-on (Cloudflare Tunnel) pointing to `http://<home-assistant>:3000`.
  See https://famlin.app/docs/cloudflare-tunnel.
- Port forwarding on your router plus the **Caddy** or **DuckDNS** add-on for HTTPS.

When you use either, set the `trust_proxy` option to `true`.

## Troubleshooting

- *Add-on stops right after start:* read the Log tab. A message that the database
  is newer than the app means you downgraded; install the newer version again.
- *Port 3000 already in use:* change the host port under Network in the add-on configuration.
