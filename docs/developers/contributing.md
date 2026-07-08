---
sidebar_position: 4
---

# Contributing

Thank you for your interest in contributing to Famlin! This document provides guidelines and instructions for participating in the project.

## How to contribute

### Reporting bugs

If you find a bug, please open an issue with:

- A clear title and description
- Steps to reproduce the problem
- Expected behavior
- Actual behavior
- Environment details (OS, Node version, Docker version, etc.)
- Screenshots or logs if applicable

### Suggesting features

Feature suggestions are welcome. Please open an issue and describe:

- The problem you are trying to solve
- Your proposed solution
- Any alternatives you have considered

### Pull requests

1. Fork the repository and create a new branch from `main`.
2. Make your changes in a focused, minimal way.
3. Follow the existing code style.
4. Update documentation if your changes affect usage or deployment.
5. Ensure the project still builds and runs correctly.
6. Open a pull request with a clear description of what changed and why.

Every pull request runs through CI (GitHub Actions): typecheck and build for the backend, admin UI, web app + shared API client (`packages/api-client`, both with their own Vitest suites), mobile app, and docs site, plus a Postgres-backed check that Prisma migrations apply cleanly and a full Docker image build. All checks must pass before a PR can be merged. The PR template also asks you to confirm `npx tsc --noEmit` passes in every package you touched and that i18n keys were added in both `en` and `nl` locales for any UI string changes.

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...) for commit and PR titles — [release-please](https://github.com/googleapis/release-please) reads them to generate the changelog and version bump automatically, so a clear prefix helps your change show up correctly in the next release.

## Releases

Famlin uses release-please to automate versioning and changelogs. Merging to `main` keeps an open release pull request up to date; merging that PR cuts a GitHub Release tagged `vX.Y.Z`. The same workflow run then rewrites the GitHub Release notes into human-readable highlights and breaking changes using [GitHub Models](https://docs.github.com/en/github-models) (the raw commit-level changelog stays in a collapsed section, and `CHANGELOG.md` is untouched; if the model call fails the release simply keeps the auto-generated notes), and builds and publishes a versioned backend image to `ghcr.io/timvanonckelen/famlin`, which is what `docker-compose.yml` runs by default — see [Server setup](/server-setup) and [Maintenance](/maintenance#building-from-source-instead) if you need to build from source instead.

The same release also builds the mobile app with EAS (`mobile-build.yml`, `production` profile, both platforms) and submits it straight to the App Store and Play Store production tracks via `eas submit --auto-submit`. This needs several secrets configured on the repo (Settings → Secrets and variables → Actions), none of which are required just to build:

- `EXPO_TOKEN` — required for any EAS build (manual or release).
- `ASC_APP_ID`, `APPLE_TEAM_ID`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64` (an App Store Connect API key `.p8`, base64-encoded) — iOS submission.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64` (a Google Play service account JSON key, base64-encoded) — Android submission.

A brand-new app still needs its first build uploaded manually through App Store Connect / Play Console — the Play Developer API rejects submissions until an app has at least one release created through the Play Console UI, and a first App Store submission needs its store listing filled in before Apple will review it. After that, `eas submit` can publish subsequent releases to the same app/track.

The workflow can also be run manually from the Actions tab (`workflow_dispatch`) with a chosen platform and `preview`/`development`/`production` profile — this only builds (no store submission) and is the easy path for ad-hoc test builds, since `preview`/`development` use EAS's internal distribution (installable straight from the build link, no store or extra secrets needed).

## Development setup

See the [Quick start](./quick-start) guide. In short:

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET
docker compose up --build
```

## Code style

- Use TypeScript for backend, admin, web, and shared-package code.
- Follow the existing project structure and naming conventions described in the [Architecture](./architecture) page.
- Keep commits focused and write clear commit messages.

## Communication

Please be respectful and constructive in all interactions. See the [Code of Conduct](https://github.com/TimVanOnckelen/famlin/blob/main/CODE_OF_CONDUCT.md) for details.

## License

By contributing to Famlin, you agree that your contributions will be licensed under the [MIT License](https://github.com/TimVanOnckelen/famlin/blob/main/LICENSE).
