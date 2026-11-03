# Famlin on Umbrel (community app store)

This folder is staged here as a ready-to-publish **Umbrel community app store**.
It is meant to live in its own repository, which Umbrel users add by URL.
(Issue: TimVanOnckelen/famlin#342.)

```
umbrel-app-store.yml        store id + name
famlin-famlin/              app id = <store id>-<app name>
  umbrel-app.yml            listing (name, description, port, gallery ...)
  docker-compose.yml        app_proxy + server + postgres
  hooks/pre-start           creates the data folders with the right owner
```

## How to publish

1. Create the repository `https://github.com/TimVanOnckelen/famlin-umbrel-app-store`
   (this URL is a placeholder; use whatever you create and update the docs page
   `docs/docs/install-umbrel-casaos.md` to match).
2. Copy the **contents** of this folder (not the folder itself) to the repo root.
3. Pin the image digest: `docker buildx imagetools inspect ghcr.io/timvanonckelen/famlin:<version>`
   and change `image:` to `ghcr.io/timvanonckelen/famlin:<version>@sha256:<index digest>`.
   Umbrel's official store requires digests; community stores do not.
4. Add real icon and gallery images (the manifest currently points at files in
   the main repo). Umbrel's official store wants a 256x256 SVG icon and 3 to 5
   screenshots.
5. Test on an Umbrel: *App Store, three dots, Community App Stores, paste the
   repo URL, install Famlin*.
6. To get into the **official** Umbrel store instead, open a PR to
   `getumbrel/umbrel-apps` with the app folder renamed to `famlin` (drop the
   `famlin-` store prefix, set `id: famlin`, `APP_HOST: famlin_server_1`) and
   the digest-pinned image.

## Things to verify (not testable without an Umbrel)

- `hooks/pre-start` assumes `APP_DATA_DIR` is exported to hooks. If it is not,
  the hook is a no-op and the server may fail to write to its bind mounts; in
  that case drop the hook and instead run the server as root or pre-create the folders.
- `PROXY_AUTH_ADD: "false"` turns off Umbrel's own login in front of the app.
  Famlin has its own accounts and the phone apps need direct API access. Remove
  it if you want Umbrel's password in front of the web app too (the phone apps
  will then stop working).
- `APP_SEED` is used as the database password; it is stable per app install.

## Remote access

Family members use the phone apps from outside your home, so the server must be
reachable from the internet. Use Umbrel's own remote access options, or put the
app behind a Cloudflare Tunnel: https://famlin.app/docs/cloudflare-tunnel.
The proxy on Umbrel already sets `TRUST_PROXY=true`.

## Releasing a new version

After a Famlin release's image is published, from the main repo run
`deploy/bump-version.sh <version>`, re-pin the digest, copy this folder to the
store repo and push. Umbrel shows the update when `version` in `umbrel-app.yml`
changes.
