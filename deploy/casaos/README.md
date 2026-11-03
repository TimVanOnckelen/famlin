# Famlin on CasaOS / ZimaOS

Staged here as a CasaOS app. (Issue: TimVanOnckelen/famlin#342.)

```
famlin/docker-compose.yml   compose file with the top-level x-casaos block
```

## Two ways to publish

**A. Your own app store (quick, works with CasaOS today).** Create the repo
`https://github.com/TimVanOnckelen/famlin-casaos-app-store` (placeholder URL)
and lay it out like the official store: `Apps/Famlin/docker-compose.yml`
(copy `famlin/docker-compose.yml`), plus `Apps/Famlin/icon.png`,
`thumbnail.png` and `screenshot-1.png` if you want local assets. Users add it
under *App Store, Settings, Add source* with the zip URL
`https://github.com/TimVanOnckelen/famlin-casaos-app-store/archive/refs/heads/main.zip`.

**B. The official store.** Fork `IceWhaleTech/CasaOS-AppStore`, add
`Apps/Famlin/` with `docker-compose.yml`, `icon.png` (256x256), `thumbnail.png`
and `screenshot-1.png` to `screenshot-3.png`, and open a PR. The `icon`,
`thumbnail` and `screenshot_link` fields then point at the files in that repo
(`https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Famlin/icon.png`).

Before publishing, pin the digest: change `image:` to
`ghcr.io/timvanonckelen/famlin:<version>@sha256:<index digest>` (get it from
`docker buildx imagetools inspect`).

## Notes and uncertain fields

- The database password is a fixed string in the compose file. The database is
  not published to the host and sits on the app's own network, so it is not
  reachable from outside. Edit it in both services before the first start if you prefer.
- `x-casaos` field names follow the current official store. Items to double
  check with the CasaOS import dialog: `scheme`, `thumbnail`, `screenshot_link`
  (the `TRUST_PROXY` value is editable in the install dialog).
- The first visitor creates the admin account, so there is no default login.

## Remote access

Use CasaOS/ZimaOS remote access or a Cloudflare Tunnel
(https://famlin.app/docs/cloudflare-tunnel). When Famlin sits behind such a
proxy, set the `TRUST_PROXY` environment variable to `true`.

## Releasing a new version

Run `deploy/bump-version.sh <version>` from the main repo, re-pin the digest,
and update the store repo / open a PR against the official store.
