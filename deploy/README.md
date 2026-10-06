# Platform packages

Ready-made packages for self-hosting platforms. Both run the same pre-built
`ghcr.io/timvanonckelen/famlin` image (multi-arch: `linux/amd64` + `linux/arm64`)
plus a Postgres sidecar — nothing here is built from source.

## Umbrel (`umbrel/famlin/`)

An [Umbrel App Store](https://github.com/getumbrel/umbrel-apps) package,
following the repo's `umbrel-package-app` guidance:

- `app_proxy` on host port **3264** → the container's `3000`, with Umbrel auth
  **off** (`PROXY_AUTH_ADD: "false"`): family members have no Umbrel login, and
  the mobile apps can't send Umbrel's auth cookie. Famlin's own login and
  first-run `/admin` setup screen take over instead, the same posture Immich uses.
- `exports.sh` derives the Postgres password and `JWT_SECRET` per install with
  `derive_entropy` — no secrets for the user to manage.
- Data lives in `${APP_DATA_DIR}/data/{db,uploads}` (movable, backed up by umbrelOS).
- `TRUST_PROXY` stays at its default (`false`): Umbrel's proxy preserves the
  `Host` header, which is all Famlin needs to build invite links.

### Submitting

1. Cut a Famlin release **after** the multi-arch build change landed (earlier
   images are amd64-only and fail Umbrel's `image.architecture` lint).
2. Get the release's manifest-list digest:
   ```sh
   docker buildx imagetools inspect ghcr.io/timvanonckelen/famlin:<version>
   ```
   and confirm both `linux/amd64` and `linux/arm64` are listed.
3. In `umbrel/famlin/`, set `version:` in `umbrel-app.yml` and the
   `server` image in `docker-compose.yml` to `<version>@sha256:<digest>`.
4. Fork [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps), copy
   `umbrel/famlin/` to the fork's root as `famlin/`, then run:
   ```sh
   npm ci && npm run lint:apps -- famlin --check-images && git diff --check
   ```
5. Test it on an umbrelOS device (install, run setup at `/admin`, post a photo,
   restart the app, check the data is still there), then open the PR. Set
   `submission:` to the PR URL. Put screenshots and the logo
   (`docs/static/img/logo.svg`) in the PR body, not in the package: the Umbrel
   team hosts the gallery and icon assets.

On later releases, bump `version`, the image tag + digest, and `releaseNotes`
in a PR to umbrel-apps (their `umbrel-update-app` skill).

## Coolify (`coolify/famlin.yaml`)

A [Coolify service template](https://coolify.io/docs/get-started/contribute/service).
Coolify fills in the magic variables: `SERVICE_URL_FAMLIN_3000` gives the
app a domain and routes it through Coolify's proxy, `SERVICE_PASSWORD_64_JWT` generates the
JWT secret, and `SERVICE_USER/PASSWORD_POSTGRES` generate the database credentials.
`TRUST_PROXY=true` is set because Coolify always puts its own reverse proxy in front.

- **Use it now:** in Coolify, *+ New → Docker Compose Empty*, paste the file,
  deploy, then open `https://<your-domain>/admin` to create the first admin.
- **Get it into Coolify's one-click catalog:** open a PR against
  [coollabsio/coolify](https://github.com/coollabsio/coolify) adding
  `templates/compose/famlin.yaml` and the logo as `public/svgs/famlin.svg`
  (`coolify/famlin.svg` here). The template tracks `latest` (overridable with
  `FAMLIN_VERSION`), so it needs no update per release.
