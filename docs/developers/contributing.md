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
4. Document every new feature in the same PR. See [Documentation is required for features](#documentation-is-required-for-features) below.
5. Ensure the project still builds and runs correctly.
6. Open a pull request with a clear description of what changed and why.

Every pull request runs through CI (GitHub Actions): typecheck and build for the backend, admin UI, web app + shared API client (`packages/api-client`, both with their own Vitest suites), mobile app, and docs site, plus ESLint across the backend, admin UI, web app, shared API client, and mobile app (the `Lint` job — `npm run lint` in each package, or the root `npm run lint` to run all of them), a Prettier formatting check across the same packages (`npm run format:check` from the root — see [Code style](#code-style)), a Postgres-backed check that Prisma migrations apply cleanly, a full Docker image build, an API breaking-change check (see [Breaking changes](#breaking-changes) below), a documentation check for feature PRs (see [Documentation is required for features](#documentation-is-required-for-features) below), a dependency review (GitHub's `dependency-review-action` diffs every lockfile against the base branch and fails if a dependency the PR adds or bumps has a known vulnerability of high severity or worse, or a license not on the MIT-compatible allow list in `.github/dependency-review-config.yml` — a reviewed exception for one package goes in that file's `allow-dependencies-licenses`, with the reason; the job summary also lists each new package's OpenSSF Scorecard, and on failure the summary is posted as a PR comment), and a mobile native-linking guard (`mobile/scripts/check-native-peer-deps.mjs` — fails if a native module is only transitively installed rather than a direct dependency of `mobile/package.json`, since React Native autolinking would silently skip it and the built app would crash at launch; fix with `npx expo install <package>` in `mobile/`), and a mobile Expo SDK version check (`npx expo install --check` — fails if a dependency's installed version drifts from the Expo SDK's expected set in `expo/bundledNativeModules.json`, since Expo then mixes precompiled and source-built native frameworks and the released binary crashes at launch while dev builds, `tsc`, and Jest all stay green; the same check also gates `mobile-build.yml` right before the store build). Because of both guards, always add or bump mobile native dependencies with `npx expo install <package>` rather than editing `mobile/package.json` by hand. All checks must pass before a PR can be merged. The PR template also asks you to confirm `npx tsc --noEmit` and `npm run lint` pass in every package you touched and that i18n keys were added in the `en`, `nl` and `zh` locales (`npm run check:locales` from the repo root verifies key and placeholder parity) for any UI string changes.

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...) for commit and PR titles — [release-please](https://github.com/googleapis/release-please) reads them to generate the changelog and version bump automatically, so a clear prefix helps your change show up correctly in the next release.

### Documentation is required for features

**Every new feature ships with its documentation, in the same pull request.** A feature that isn't documented doesn't exist for the admins and families who use Famlin. "We'll document it later" is how the docs fell behind before.

What "documented" means depends on who notices the feature:

- **Members** (something new in the app or web app): explain it in the Docs tab (`docs/docs/`), under *Using Famlin* if it needs a page of its own.
- **Admins / self-hosters** (a setting, an admin page, an env var, a deploy step): update the matching page in `docs/docs/`. For a new admin screen or settings section, add a **screenshot** under `docs/docs/img/`. Describe every setting: what it does, its default, and when you'd change it.
- **Developers / API users** (an endpoint, a field, an architectural pattern): update `docs/openapi/famlin.yaml` (and regenerate the API reference) and `docs/developers/architecture.md`.
- **Marketing claims** (a headline feature): consider `website/index.html` too.

The [Documentation table in CLAUDE.md](https://github.com/TimVanOnckelen/famlin/blob/main/CLAUDE.md#documentation) maps each kind of change to the page to update.

CI enforces this: the `Documentation required for features` job fails a PR whose title or any commit is a `feat` (`feat:`, `feat(scope):`, `feat!:`) but that changes nothing under `docs/` or `website/`. If a feature really has nothing to document (rare: a `feat` with no visible behavior is usually a `refactor` or `chore`), add a line `Docs-not-needed: <reason>` to a commit message or to the PR description. After editing the description, re-run the job or push again, because the check reads the description only when it runs.

Fixes and refactors aren't checked automatically, but they should still update the docs when they change documented behavior.

### Breaking changes

If your change is **breaking** — an existing deployment would need manual action when upgrading (an API endpoint or response changes incompatibly, a startup env var becomes required, a default changes in a way that alters behavior) — you must mark it in conventional-commit form, in the commit message or the PR title:

- append `!` to the type: `feat!: require TRUST_PROXY behind a reverse proxy`, or
- add a footer explaining the migration: `BREAKING CHANGE: media tokens issued before this release are invalidated; clients must request a new one.`

This marker is what drives the release automation: release-please adds the commit to a dedicated **⚠ BREAKING CHANGES** section in `CHANGELOG.md` and the GitHub Release, applies the corresponding version bump, and the AI-rewritten release notes only warn self-hosting admins about changes marked this way — an unmarked breaking change ships silently as an ordinary entry. This applies to AI coding agents too: if you use Claude or a similar assistant to write commits, make sure it marks breaking changes the same way (the repo's `CLAUDE.md` instructs it to).

CI backs this up for the API surface: when a PR changes `docs/openapi/famlin.yaml` in a way [oasdiff](https://github.com/oasdiff/oasdiff) classifies as breaking, the `API breaking-change check` job fails unless a commit in the PR or the PR title carries a breaking marker. Breaking changes outside the API spec (env vars, deploy steps) can't be detected automatically — marking those is on you.

## Releases

Famlin uses release-please to automate versioning and changelogs. Merging to `main` keeps an open release pull request up to date; merging that PR cuts a GitHub Release tagged `vX.Y.Z`. The same workflow run then rewrites the GitHub Release notes into human-readable highlights and breaking changes using [GitHub Models](https://docs.github.com/en/github-models) (the raw commit-level changelog stays in a collapsed section, and `CHANGELOG.md` is untouched; if the model call fails the release simply keeps the auto-generated notes), credits everyone who took part — commit and pull request authors (flagging first-time contributors) and the reporters of issues the release closes, leaving out bots and AI accounts, and crediting the maintainer only for commits or pull requests they authored, not for merging (`.github/scripts/release-thanks.sh`) — and builds and publishes a versioned backend image to `ghcr.io/timvanonckelen/famlin`, which is what `docker-compose.yml` runs by default — see [Server setup](/server-setup) and [Maintenance](/maintenance#building-from-source-instead) if you need to build from source instead.

The same release also builds the mobile app with EAS (`mobile-build.yml`, `production` profile, both platforms) and submits it straight to the App Store and Play Store production tracks via `eas submit --auto-submit`. `eas submit` only uploads the iOS binary, so the workflow then runs `scripts/asc-submit-for-review.mjs`. That script waits for App Store Connect to finish processing the build, creates (or reuses) the App Store version, attaches the build, fills in any empty "What's New" text with a generic "Bug fixes and improvements" (text you entered yourself is kept) and submits it for App Review. If an older version is still waiting for review, the step fails and asks you to withdraw it first; re-running the job is safe. This needs several secrets configured on the repo (Settings → Secrets and variables → Actions), none of which are required just to build:

- `EXPO_TOKEN` — required for any EAS build (manual or release).
- `ASC_APP_ID`, `APPLE_TEAM_ID`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64` (an App Store Connect API key `.p8`, base64-encoded) — iOS submission.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64` (a Google Play service account JSON key, base64-encoded) — Android submission.

A brand-new app still needs its first build uploaded manually through App Store Connect / Play Console — the Play Developer API rejects submissions until an app has at least one release created through the Play Console UI, and a first App Store submission needs its store listing filled in before Apple will review it. After that, `eas submit` can publish subsequent releases to the same app/track.

The workflow can also be run manually from the Actions tab (`workflow_dispatch`) with a chosen platform and `preview`/`development`/`production` profile — this only builds (no store submission) and is the easy path for ad-hoc test builds, since `preview`/`development` use EAS's internal distribution (installable straight from the build link, no store or extra secrets needed).

## Development setup

See the [Quick start](./quick-start.md) guide. In short:

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET
docker compose up --build
```

## Code style

- Use TypeScript for backend, admin, web, and shared-package code.
- **Formatting is Prettier's job, not yours.** One root config (`.prettierrc.json`, `.prettierignore`) covers the backend, admin UI, web app, shared API client and mobile app; run `npm run format` from the repo root before committing (it needs the root `npm install`, also for `mobile/`, which otherwise installs independently). CI's `Lint` job fails on unformatted code via `npm run format:check`. Don't hand-reindent or reformat code you aren't otherwise changing — formatting-only churn makes reviews and `git blame` harder and conflicts with other open branches. Markdown, YAML, JSON and HTML are deliberately not formatted.
- Follow the existing project structure and naming conventions described in the [Architecture](./architecture.md) page.
- Keep commits focused and write clear commit messages.
- **Icons come from one flat, minimal set — never the platform's native icons, and never an emoji.** Each front end has an `Icon` component that owns the whole vocabulary: `mobile/src/components/Icon.tsx` (Feather via `@expo/vector-icons`), `web/src/components/Icon.tsx`, and `backend/admin/src/components/Icon.tsx` (both inline Feather paths). Use the same Feather name across apps for the same concept, and add a new icon to the component rather than dropping a one-off `<svg>`, another `@expo/vector-icons` family, or an emoji into a screen — an emoji is drawn by the platform's own font, so it changes shape per OS and can't take a tint. The one exception is **reactions** (👍❤️😂😮😢🥰, `constants/reactions.ts` in both apps), which stay native platform emoji: a reaction is the user's own expressive content, not chrome. Decorative emoji also don't belong in locale strings — put the icon in the component and keep the translated string plain text.

## Communication

Please be respectful and constructive in all interactions. See the [Code of Conduct](https://github.com/TimVanOnckelen/famlin/blob/main/CODE_OF_CONDUCT.md) for details.

## License

By contributing to Famlin, you agree that your contributions will be licensed under the [MIT License](https://github.com/TimVanOnckelen/famlin/blob/main/LICENSE).
