# Famlin Home Assistant add-on repository

Staged here as a ready-to-publish **Home Assistant add-on repository**.
It is meant to live in its own repository, which Home Assistant users add by
URL. (Issue: TimVanOnckelen/famlin#343.)

```
repository.yaml     repository metadata
famlin/             the add-on
  config.yaml       add-on definition (options, ports, backup mode)
  Dockerfile        FROM the published Famlin image + PostgreSQL 16
  rootfs/run.sh     starts postgres, then the server; stops both cleanly
  DOCS.md README.md CHANGELOG.md icon.png logo.png
```

## How to publish

1. Create `https://github.com/TimVanOnckelen/famlin-ha-addon` (placeholder URL;
   update `repository.yaml` and `docs/docs/install-home-assistant.md` if you
   use another).
2. Copy the **contents** of this folder to the repo root.
3. In Home Assistant: *Settings, Add-ons, Add-on store, three dots,
   Repositories*, paste the repo URL, then install **Famlin**.

The add-on builds locally on the user's Home Assistant from the `Dockerfile`
(`FROM ghcr.io/timvanonckelen/famlin:<version>`), so no add-on image has to be
published. Optionally publish pre-built images later to speed up installs.

## Design notes

- Bundled Postgres: `run.sh` initialises `/data/postgres` on first start with a
  random password (kept in `/data/postgres_password`), listens on 127.0.0.1
  only, and stops Postgres after the server on SIGTERM. The container starts as
  root only to fix ownership, then runs postgres as `postgres` and the server as `node`.
- All state is under `/data`, so Home Assistant backups include everything;
  `backup: cold` stops the add-on during a backup.
- `ingress` is off on purpose: the phone apps and invite links need a regular URL.
- The base Alpine release must still offer `postgresql16`; the build fails
  loudly otherwise. Do not switch major versions without a dump/restore step.

## Verified / not verified

`run.sh` was exercised against a stub server with a Postgres 16 Alpine image
(first start, restart, graceful stop). The real `apk add postgresql16` layer and
the full Famlin image start were not run in the staging environment (no
network access to Alpine mirrors or ghcr.io); run `docker build deploy/home-assistant/famlin`
once before publishing. `init: false` assumes the base image has no s6-overlay,
which is true for the Famlin image.

## Remote access

Use the Cloudflared add-on or port forwarding with Caddy/DuckDNS, and set the
`trust_proxy` option. See https://famlin.app/docs/cloudflare-tunnel.

## Releasing a new version

After a Famlin release's image is published: run `deploy/bump-version.sh <version>`
in the main repo, add a `famlin/CHANGELOG.md` entry, copy the folder to the
add-on repo and push. Home Assistant offers the update when `version` in
`config.yaml` changes.
