---
sidebar_position: 6
---

# Maintenance

## Backups

Two things need backing up:

- **`famlin-db-data`** (Docker volume) — the Postgres database: users, groups, posts, comments, settings.
- **`famlin-uploads`** (Docker volume) — uploaded photos.

Famlin can do this for you on a schedule (see [Scheduled backups](#scheduled-backups) below), or you can include the volumes in a backup routine you already have.

Both are named volumes declared in `docker-compose.yml`. Find their host paths with:

```bash
docker volume inspect famlin_famlin-db-data famlin_famlin-uploads
```

(the `famlin_` prefix is the Compose project name, usually derived from the directory the compose file lives in). Include both paths in your existing backup routine — on a Synology NAS this typically means pointing Hyper Backup or a scheduled `rsync` task at the Docker data folder that contains them.

A simple logical backup of just the database can also be taken with `pg_dump`:

```bash
docker compose exec famlin-db pg_dump -U famlin famlin > famlin-backup.sql
```

### Scheduled backups

Famlin can back itself up on a schedule. It's **off by default**: turn it on under **Server settings → Backups** in `/admin`, and pick:

- **Schedule**: daily, or weekly on Sundays.
- **Time**: the hour it runs, in the server's time zone. The suggested default is 03:00.
- **Database dumps to keep**: how many database dumps to keep (default 7). Older ones are deleted after each run.

Each run writes to the `famlin-backups` volume, mounted at `/app/backups` in the container:

- `db/famlin-<timestamp>.dump`: a `pg_dump` of the whole database in custom format (compressed, restored with `pg_restore`). Only the newest *N* are kept.
- `uploads/`: **one** mirror of the uploads volume, updated incrementally. Uploaded files never change once written, so each run only copies new files. A file that disappears from Famlin (a deleted post, an expired story) is moved to `uploads/.deleted/<date>/` and kept there for **30 days** before it's removed for good. That covers accidental deletes without the mirror growing forever.

Backups are deliberately not data-export zips: an export holds a full copy of every photo, so keeping seven of them would cost seven times your media library.

**System status** in `/admin` shows the last backup's result and size, the next scheduled run, and a **Run backup now** button. If a backup fails, or no backup has succeeded for more than twice the schedule interval (two days for daily, two weeks for weekly), every admin page shows a banner and admins get an email, at most one per problem per day. Emails need SMTP to be set up under Server settings → Notifications; without it you only get the banner. See [System status](./managing-users-and-content#system-status).

:::tip Keep backups off the machine they protect
`famlin-backups` is a separate volume, but by default it's on the same disk as everything else. For real protection, bind-mount a folder on another disk or a NAS share instead:

```yaml
    volumes:
      - famlin-uploads:/app/uploads
      - /volume2/backups/famlin:/app/backups
```

The container runs as the unprivileged `node` user (uid 1000), so that folder must be writable by uid 1000. You can also keep backing up the `famlin-backups` volume itself with your existing tools.
:::

:::warning Older compose files
`famlin-backups` was added to `docker-compose.yml` together with scheduled backups. If your copy of the compose file predates it, backups are written inside the container and **lost when the container is recreated** (for example on every update). System status warns about this. Add the volume as shown in the repository's [`docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml).
:::

### Restoring from a scheduled backup

Run these from the folder that holds your `docker-compose.yml`, with `famlin-db` running.

1. List the dumps and pick one:

   ```bash
   docker compose run --rm --no-deps famlin-backend ls -l /app/backups/db
   ```

2. Stop the backend and empty the database:

   ```bash
   docker compose stop famlin-backend
   docker compose exec famlin-db psql -U famlin -d postgres \
     -c 'DROP DATABASE famlin WITH (FORCE);' -c 'CREATE DATABASE famlin OWNER famlin;'
   ```

3. Restore the dump. Use the backend image's `pg_restore`, not the database container's: the backend ships a newer Postgres client, and an older `pg_restore` can't read a newer `pg_dump`'s files.

   ```bash
   docker compose run --rm --no-deps famlin-backend sh -c \
     'pg_restore --no-owner --no-privileges -d "${DATABASE_URL%%\?*}" /app/backups/db/famlin-<timestamp>.dump'
   ```

4. If the uploads volume was lost too, copy the mirror back:

   ```bash
   docker compose run --rm --no-deps famlin-backend sh -c \
     'cp -a /app/backups/uploads/. /app/uploads/ && rm -rf /app/uploads/.deleted'
   ```

   Photos of posts deleted in the last 30 days are in `/app/backups/uploads/.deleted/<date>/`. Copy them back the same way if you're restoring a dump from before the delete.

5. Start Famlin again with `docker compose up -d`. If the dump came from an older Famlin version, pending migrations are applied on startup as usual. Your settings, accounts and passwords all come back, because the dump is the whole database.

### Restoring from a data export

The admin UI's **Data export** (Server settings → General) is a second, independent kind of backup: one zip holding every family's content and every uploaded photo/video, which you can restore onto a **new, empty** Famlin server — handy when moving hosts (NAS to VPS, off a dying machine) or when the database volume itself is what got corrupted. It doesn't need the old server to still be running, and it doesn't need shell access on either end.

1. Start the new server as usual (see [Server setup](./server-setup)), running the **same or a newer** Famlin version than the one that made the export — an export from a newer version is refused.
2. Open `/admin`. A fresh server shows the first-run setup screen; choose **Restore a backup**.
3. Pick the export zip and enter the email, name and password for your admin login. If the backup already has an account with that email, that account becomes an admin and gets this password (so it stays linked to everything you posted); otherwise a new admin account is created next to the restored ones.
4. Wait for the upload and restore to finish — for a large photo library this takes a while.

Restoring only works while the server has **no accounts at all**: it never merges into a server that's already in use, and it's refused once anyone has signed up.

**What a restore does not bring back.** The export deliberately leaves out credentials and server configuration, so after restoring:

- **Nobody else can sign in yet.** Passwords are never exported. Reconfigure OIDC/SSO under Server settings (members then sign in exactly as before, matched by email), and/or reset password-login members' passwords from the **Users** page.
- **Server settings are blank** — OIDC, allowed emails, SMTP, Immich/local media connections, store links. Set them up again. Linked albums and people mappings *are* restored, and start working again once the media source is reconfigured with the same albums.
- **Invite links, push tokens and API tokens are gone.** Create new invites as needed; the apps re-register for push on next sign-in; members recreate their API tokens.
- **Every previous session is signed out**, including on devices that were logged in to the old server.
- Notification history and the push delivery log start empty.

Treat the export as a complement to the volume backups above, not a replacement: volumes restore *everything*, including settings and passwords; the export is the one you can restore without them.

## Updating

```bash
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

The backend container re-runs `prisma migrate deploy` on every start, so pending schema migrations are applied automatically — there's no separate migration step to remember.

When stopped or updated, the backend finishes requests already in progress (an upload mid-write, say) for up to 30 seconds (`stop_grace_period` in `docker-compose.yml`) before it exits.

**Keep your `docker-compose.yml` up to date too.** `pull` only updates the image, not your copy of the compose file. Releases occasionally improve the compose file itself (for example the backend healthcheck, log rotation and shutdown grace period). Compare yours against the [repository's `docker-compose.yml`](https://github.com/TimVanOnckelen/famlin/blob/main/docker-compose.yml), or the one attached to each release, after updating.

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

To try the current development build from `main`, set `FAMLIN_VERSION=dev`
in `.env`, then run the same `pull` and `up -d` commands above. The rolling
`dev` image is published after pushes or PR merges into `main` that change
files relevant to the image, for both `linux/amd64` and `linux/arm64`.
Docs-only, website-only, mobile-only, and Markdown-only changes are skipped,
as are release PR merges (the release workflow builds those commits).

:::warning Use dev on a test instance only

The container runs `prisma migrate deploy` on startup. A `dev` image may apply
database migrations that are not included in any release yet. Switching back
to an older release can leave that release running against an incompatible
schema. Stay on `dev` until a release containing those migrations ships and
then pin to it, or restore a backup taken before switching to `dev`.

:::

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

**`famlin-backend` shows as `unhealthy`** — its healthcheck calls `GET /health`, which returns `503` when the database is unreachable or the uploads volume isn't writable. The reason is logged: run `docker compose logs famlin-backend` and look for `health check failed`. Check that `famlin-db` is running and healthy, and that the disk holding the `famlin-uploads` volume isn't full or mounted read-only.

**Migrations fail on startup** — check `docker compose logs famlin-backend`. This usually means the `famlin-db` container isn't reachable yet or `DATABASE_URL` doesn't match its credentials.

**Uploaded photos disappear after a redeploy** — this means the `famlin-uploads` volume isn't being reused, usually because the compose project name changed (e.g. running from a different directory) or `-v` / `down -v` was used, which removes volumes. Avoid `docker compose down -v` in production; use plain `down` (or just `up -d --build` for updates, no `down` needed at all).

**Family members get "Network Error" when posting photos or videos** — the upload was cut off before it finished. If nothing about the upload appears in `docker compose logs famlin-backend`, the request never reached Famlin, so the reverse proxy rejected it: raise its request body limit (Nginx's default is 1 MB) and its read/send timeouts — see [Put a reverse proxy in front](./server-setup#4-put-a-reverse-proxy-in-front). Famlin's own per-file limit is 200 MB, and a file over it answers with a clear "file too large" message instead.

**Can't reach `/admin` through the reverse proxy but the container works on `localhost:3000`** — check that the proxy forwards the full path (not just `/`) and doesn't strip the `/admin` prefix.

See also the [Security policy](./security) page for hardening recommendations.

## Moving media between local and S3 storage

Local storage remains the default. Media URLs and Upload authorization records
stay unchanged when changing drivers. Azure and linked local albums
(`localMediaPath`) are independent of this feature. Branding always remains on
the local uploads volume.

Configure the backend environment, then restart **all backend instances with the
same primary and fallback configuration**. During migration, new uploads go to
the primary; reads try the primary, then the fallback only when an object is
missing. An access or connection error is reported, rather than treated as a
missing object.

For local → S3:

```dotenv
STORAGE_DRIVER=s3
S3_BUCKET=famlin
S3_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_PREFIX=media
S3_FORCE_PATH_STYLE=true
STORAGE_FALLBACK_DRIVER=local
STORAGE_FALLBACK_UPLOADS_DIR=/app/uploads
```

Supply `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together, optionally with
`S3_SESSION_TOKEN`. Omit all three to use the standard AWS credential chain.
`S3_ENDPOINT` is optional for AWS S3. `S3_FORCE_PATH_STYLE` defaults to `false`.
For S3 → local set `STORAGE_DRIVER=local`, `STORAGE_FALLBACK_DRIVER=s3`, and
configure the source with `STORAGE_FALLBACK_S3_BUCKET`,
`STORAGE_FALLBACK_S3_ENDPOINT`, `STORAGE_FALLBACK_S3_REGION`,
`STORAGE_FALLBACK_S3_ACCESS_KEY_ID`, `STORAGE_FALLBACK_S3_SECRET_ACCESS_KEY`,
`STORAGE_FALLBACK_S3_SESSION_TOKEN`, `STORAGE_FALLBACK_S3_PREFIX`, and
`STORAGE_FALLBACK_S3_FORCE_PATH_STYLE`. Source and destination must not overlap.

Open **Admin → Storage**, inspect the locations and start migration. The worker
lists the source, including legacy objects without Upload rows, and excludes
branding, temporary and internal objects. It streams each copy and reads the
destination again to verify SHA-256. S3 ETags are not used as hashes. Existing
identical objects are verified; different objects are recorded as conflicts and
never overwritten. Resolve conflicts deliberately, then retry. PostgreSQL locks
coordinate workers and application writes/deletes. Do not modify the source
externally during migration or cleanup.

Interrupted running jobs resume after restart only when both location
fingerprints still match. Credentials are not part of the fingerprint, allowing
credential rotation. Errors and conflicts are retained in the operational journal;
it is not part of portable family exports.

Cleanup is a separate action. It is available after a complete verification and
requires entering the fallback's fingerprint. Each source object and its copy
are checked again before the source is removed. Changed, conflicting, or
unverified objects remain. After successful cleanup, remove the fallback env
variables yourself and restart all instances. Famlin never rewrites environment
configuration. Keep backups while moving storage.

The backend needs list, read, write, multipart-upload and delete permissions for
its configured S3 prefix, plus access to check the bucket. `/health` tests primary
storage with a small temporary write/delete; the admin Storage page reports
fallback availability. S3 capacity is not represented by local disk statistics.
MinIO tests establish behavior against MinIO only, not compatibility with every
S3-compatible provider.

### Exports and backups with external media

Admin export accepts `GET /api/admin/export?includeMedia=false` (default `true`).
Branding is always included. A media-free export records `includeMedia: false`
and the required storage keys and sizes in its manifest. Restore validates that
those objects are already present in the configured primary or fallback before
writing database rows, and reports missing or size-mismatched objects. Old
archives remain supported. Full and member exports stream media through storage.

**Server settings → Backups → Include media in backups** defaults to enabled.
When disabled, scheduled/manual backups keep the database dump and local
branding, without downloading media or deleting an existing media mirror. When
enabled, the mirror reads primary and fallback without duplicates, retaining the
existing policy of keeping deleted files for 30 days. S3 does not replace a
backup: keep independent copies and test recovery.
