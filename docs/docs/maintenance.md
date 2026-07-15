---
sidebar_position: 6
---

# Maintenance

## Backups

Two things need backing up:

- **`famlin-db-data`** (Docker volume) — the Postgres database: users, groups, posts, comments, settings.
- **`famlin-uploads`** (Docker volume) — uploaded photos.

Both are named volumes declared in `docker-compose.yml`. Find their host paths with:

```bash
docker volume inspect famlin_famlin-db-data famlin_famlin-uploads
```

(the `famlin_` prefix is the Compose project name, usually derived from the directory the compose file lives in). Include both paths in your existing backup routine — on a Synology NAS this typically means pointing Hyper Backup or a scheduled `rsync` task at the Docker data folder that contains them.

A simple logical backup of just the database can also be taken with `pg_dump`:

```bash
docker compose exec famlin-db pg_dump -U famlin famlin > famlin-backup.sql
```

## Updating

```bash
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

The backend container re-runs `prisma migrate deploy` on every start, so pending schema migrations are applied automatically — there's no separate migration step to remember.

If you pinned `FAMLIN_VERSION` in `.env` (see below), bump it before pulling so you get the version you expect rather than a moved `latest` tag.

If you're [building from source](#building-from-source-instead) instead of running the pre-built image, update with `git pull && docker compose up -d --build` instead.

## Staying up to date

The admin dashboard (`/admin`) checks the [GitHub releases page](https://github.com/timvanonckelen/famlin/releases) for the running server's version and shows a banner — "A new version is available" with a link to that release's notes — whenever a newer version has shipped than the one you're running. No configuration needed; it's a one-shot, fail-soft check (no notice at all if GitHub is unreachable or rate-limited).

If you'd rather be notified outside the admin UI, "Watch" the repository's releases on GitHub (**Watch → Custom → Releases** on the [repo page](https://github.com/timvanonckelen/famlin)) to get an email/notification per release.

### Automating updates with Watchtower

For a fully hands-off setup, [Watchtower](https://containrrr.dev/watchtower/) can pull and restart `famlin-backend` whenever a new image is published. Scope it to just that container so your database and other services aren't touched:

```yaml title="docker-compose.yml"
watchtower:
  image: containrrr/watchtower
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  command: --interval 3600 famlin-backend
  restart: unless-stopped
```

Since schema migrations run automatically on start (see above), an unattended update also means unattended migrations. That's usually fine, but a breaking change would apply itself before you've had a chance to read the release notes — if you'd rather review [breaking changes](https://github.com/timvanonckelen/famlin/releases) first, stick to the manual `pull`/`up -d` flow above, or pin `FAMLIN_VERSION` and bump it deliberately instead of running Watchtower against `latest`.

## Pinning a version

`docker-compose.yml` runs the pre-built image published to `ghcr.io/timvanonckelen/famlin` on every tagged release (e.g. `ghcr.io/timvanonckelen/famlin:1.2.0`, plus a rolling `latest`). By default it tracks `latest`; set `FAMLIN_VERSION` in `.env` to pin a specific version instead, so updates are a deliberate, reviewed step:

```bash title=".env"
FAMLIN_VERSION=1.2.0
```

Bump it and run `docker compose pull && docker compose up -d` when you're ready to update.

## Building from source instead

If you'd rather build the backend image yourself (e.g. you're running a fork, or testing an unreleased change) instead of pulling from `ghcr.io`, replace the `image:` line for `famlin-backend` in your compose file with a `build:` block:

```yaml title="docker-compose.yml"
famlin-backend:
  build:
    context: .
    dockerfile: backend/Dockerfile
  # remove the `image:` line
```

The build context must be the **repository root**, not `backend/` — the image also bundles the member-facing web app (`web/` and `packages/`), which live outside `backend/`. You'll need a full checkout of the repository alongside your compose file for this. Update with `git pull && docker compose up -d --build`.

## Using an external database

If you'd rather run Postgres outside of Compose (a managed database, an existing Postgres instance on the NAS, etc.), remove the `famlin-db` service from your compose file (or override it to a no-op) and point `DATABASE_URL` in `.env` at your instance:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/famlin?schema=public
```

Make sure the database and user already exist — Famlin does not create the database itself, only the schema inside it (via `prisma migrate deploy` on startup).

## Troubleshooting

**Containers won't start / `JWT_SECRET is required`** — `docker-compose.yml` fails fast if `JWT_SECRET` isn't set. Confirm `.env` is in the same directory you run `docker compose` from.

**Migrations fail on startup** — check `docker compose logs famlin-backend`. This usually means the `famlin-db` container isn't reachable yet or `DATABASE_URL` doesn't match its credentials.

**Uploaded photos disappear after a redeploy** — this means the `famlin-uploads` volume isn't being reused, usually because the compose project name changed (e.g. running from a different directory) or `-v` / `down -v` was used, which removes volumes. Avoid `docker compose down -v` in production; use plain `down` (or just `up -d --build` for updates, no `down` needed at all).

**Can't reach `/admin` through the reverse proxy but the container works on `localhost:3000`** — check that the proxy forwards the full path (not just `/`) and doesn't strip the `/admin` prefix.

See also the [Security policy](./security) page for hardening recommendations.
