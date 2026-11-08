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

Every pull request runs through CI (GitHub Actions): typecheck and build for the backend, admin UI, web app + shared API client (`packages/api-client`, both with their own Vitest suites), mobile app, and docs site, plus ESLint across the backend, admin UI, web app, shared API client, and mobile app (the `Lint` job — `npm run lint` in each package, or the root `npm run lint` to run all of them), a Prettier formatting check across the same packages (`npm run format:check` from the root — see [Code style](#code-style)), a Postgres-backed check that Prisma migrations apply cleanly, a full Docker image build with end-to-end smoke tests against it (`e2e/`, Playwright in Chromium on the amd64 image, skipped when a PR touches only docs, the website or mobile; see [End-to-end smoke tests](./quick-start.md#end-to-end-smoke-tests)), an API breaking-change check (see [Breaking changes](#breaking-changes) below), a check that the shared API client still works against the oldest supported server (see [Supporting older servers](#supporting-older-servers) below), a documentation check for feature PRs (see [Documentation is required for features](#documentation-is-required-for-features) below), a dependency review (GitHub's `dependency-review-action` diffs every lockfile against the base branch and fails if a dependency the PR adds or bumps has a known vulnerability of high severity or worse, or a license not on the MIT-compatible allow list in `.github/dependency-review-config.yml` — a reviewed exception for one package goes in that file's `allow-dependencies-licenses`, with the reason; the job summary also lists each new package's OpenSSF Scorecard, and on failure the summary is posted as a PR comment), and a mobile native-linking guard (`mobile/scripts/check-native-peer-deps.mjs` — fails if a native module is only transitively installed rather than a direct dependency of `mobile/package.json`, since React Native autolinking would silently skip it and the built app would crash at launch; fix with `npx expo install <package>` in `mobile/`), and a mobile Expo SDK version check (`npx expo install --check` — fails if a dependency's installed version drifts from the Expo SDK's expected set in `expo/bundledNativeModules.json`, since Expo then mixes precompiled and source-built native frameworks and the released binary crashes at launch while dev builds, `tsc`, and Jest all stay green; the same check also gates `mobile-build.yml` right before the store build). Because of both guards, always add or bump mobile native dependencies with `npx expo install <package>` rather than editing `mobile/package.json` by hand. All checks must pass before a PR can be merged. The PR template also asks you to confirm `npx tsc --noEmit` and `npm run lint` pass in every package you touched and that i18n keys were added in the `en`, `nl`, `zh` and `pt-PT` locales (`npm run check:locales` from the repo root verifies key and placeholder parity) for any UI string changes.

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...) for commit and PR titles — [release-please](https://github.com/googleapis/release-please) reads them to generate the changelog and version bump automatically, so a clear prefix helps your change show up correctly in the next release.

### Documentation is required for features

**Every new feature ships with its documentation, in the same pull request.** A feature that isn't documented doesn't exist for the admins and families who use Famlin. "We'll document it later" is how the docs fell behind before.

What "documented" means depends on who notices the feature:

- **Members** (something new in the app or web app): explain it in the Docs tab (`docs/docs/`), under *Using Famlin* if it needs a page of its own.
- **Admins / self-hosters** (a setting, an admin page, an env var, a deploy step): update the matching page in `docs/docs/`. For a new admin screen or settings section, add a **screenshot** under `docs/docs/img/`. Describe every setting: what it does, its default, and when you'd change it.
- **Developers / API users** (an endpoint, a field, an architectural pattern): update `docs/openapi/famlin.yaml` (and regenerate the API reference) and `docs/developers/architecture.md`.
- **Marketing claims** (a headline feature): consider `website/index.html` too.

The [Documentation table in AGENTS.md](https://github.com/TimVanOnckelen/famlin/blob/main/AGENTS.md#documentation) maps each kind of change to the page to update.

CI enforces this: the `Documentation required for features` job fails a PR whose title or any commit is a `feat` (`feat:`, `feat(scope):`, `feat!:`) but that changes nothing under `docs/` or `website/`. If a feature really has nothing to document (rare: a `feat` with no visible behavior is usually a `refactor` or `chore`), add a line `Docs-not-needed: <reason>` to a commit message or to the PR description. After editing the description, re-run the job or push again, because the check reads the description only when it runs.

Fixes and refactors aren't checked automatically, but they should still update the docs when they change documented behavior.

### Breaking changes

If your change is **breaking** — an existing deployment would need manual action when upgrading (an API endpoint or response changes incompatibly, a startup env var becomes required, a default changes in a way that alters behavior) — you must mark it in conventional-commit form, in the commit message or the PR title:

- append `!` to the type: `feat!: require TRUST_PROXY behind a reverse proxy`, or
- add a footer explaining the migration: `BREAKING CHANGE: media tokens issued before this release are invalidated; clients must request a new one.`

This marker is what drives the release automation: release-please adds the commit to a dedicated **⚠ BREAKING CHANGES** section in `CHANGELOG.md` and the GitHub Release, applies the corresponding version bump, and the AI-rewritten release notes only warn self-hosting admins about changes marked this way — an unmarked breaking change ships silently as an ordinary entry. This applies to AI coding agents too: if you use an AI assistant (Claude Code, Codex, Copilot, Cursor, Gemini CLI, …) to write commits, make sure it marks breaking changes the same way (the repo's `AGENTS.md` instructs it to).

CI backs this up for the API surface: when a PR changes `docs/openapi/famlin.yaml` in a way [oasdiff](https://github.com/oasdiff/oasdiff) classifies as breaking, the `API breaking-change check` job fails unless a commit in the PR or the PR title carries a breaking marker. Breaking changes outside the API spec (env vars, deploy steps) can't be detected automatically — marking those is on you.

### Supporting older servers

Famlin is self-hosted, so a family's server is often older than the app on their phones: app stores update the app, but nobody updates the server for them. The breaking-change rules above protect older apps from a newer server. This section covers the other direction: a newer app talking to an older server. See [App and server versions](/maintenance#app-and-server-versions) for what this means for people running a server.

**The support window is three minor versions.** A mobile app release must keep working against every server back to its own minor version minus three: app 0.8.x supports servers 0.5.0 and newer. "Working" means everything the older server can do still works. What it can't do is hidden, or explained when the app can only find out by trying.

**New capabilities are detected by named features, never by version numbers.** If a change adds something a client has to detect before using it, it's a feature. That covers a new endpoint, a new request or response field the app relies on, or new behavior. A server inside the window without it would break or mislead the app. For each one:

1. Add an id to `SERVER_FEATURES` in `backend/src/serverFeatures.ts`, and the same id to `ServerFeature` in `packages/api-client/src/features.ts`.
2. Gate the client's use of it with `serverFeatureSupport(serverInfo, '<id>')` (mobile: `useServerFeatureSupport('<id>')`). Hide it when that's `unsupported`. On `unknown` (server-info not loaded yet, or, for an id that predates the field, a server older than the `features` field), try it and treat a 404 from its endpoint as unsupported. A new id is always `unsupported` on a server without the field, so it needs no extra step there.

The full steps and the rules for ids (never rename or remove one) are in [Server feature flags](./architecture.md#server-feature-flags). Web is served by the server it talks to, so it never needs these checks. Something every server in the window already has needs no id, and neither does an additive field an older app can ignore.

**Raising the app's minimum server version is a breaking change.** Mobile's `MIN_SERVER_VERSION` (`mobile/src/utils/serverVersion.ts`) is the oldest server the app supports, and the single source of truth for it: the app warns below it, and the CI check below targets it. Raising it locks out families whose server is older and moves the CI check's target forward. The three-minor window is the policy for how far it may be raised: never past the app's own minor version minus three. Raise it only when the window genuinely moves past those servers, and mark the commit as breaking (`feat!:` or a `BREAKING CHANGE:` footer naming the new minimum) so the release notes tell admins to upgrade.

**CI checks the API client against the oldest supported server.** The `Client vs oldest supported server` job (`npm run check:client-compat`, `scripts/check-client-vs-old-spec.mjs`) collects every endpoint `packages/api-client/src/*.ts` calls through `api.get`/`post`/`put`/`patch`/`delete` (calls split across lines count; calls inside comments don't). It takes the oldest supported release from mobile's `MIN_SERVER_VERSION` (the earliest `vX.Y.Z` tag at or above it) and reads `docs/openapi/famlin.yaml` as it was at that tag. It fails for every call whose method and path aren't in that spec, unless the call is annotated. Path parameter names don't matter: `/posts/${id}` matches `/api/posts/{postId}`. Fix a failure in one of two ways:

- **The endpoint is new:** put a `// requires-feature: <id>` comment in the comment block directly above the call, naming the feature id that gates it. The id must exist in `backend/src/serverFeatures.ts`, and every caller must actually check it.

  ```ts
  export async function fetchStoryTray(groupIds?: string[]): Promise<StoryTray> {
    // requires-feature: stories
    const response = await api.get<StoryTray>('/stories', { params: groupParams(groupIds) })
  ```

- **The old server had the endpoint but its spec didn't document it**, or the client only reaches it through a gate the server's own response provides (e.g. Sign in with Apple, offered only when `/auth/oidc-config` returns `appleSignInEnabled`): add an entry to `scripts/client-compat-allowlist.json` with the method, path and a reason. Keep this for legacy cases. A new endpoint always gets a feature id instead.

To check against a different release, pass `--tag vX.Y.Z` or set `CLIENT_COMPAT_TAG`. The check needs the release tags locally (`git fetch --tags`). It only sees calls made through the shared `api` axios instance, so a URL built by hand (such as the native export download in `auth.ts`) needs an `api` call or an allowlist entry covering the same endpoint.

## Releases

Famlin uses release-please to automate versioning and changelogs. Merging to `main` keeps an open release pull request up to date; merging that PR cuts a GitHub Release tagged `vX.Y.Z`. That Release starts out as a **draft** and is only published once the whole workflow below has finished (image, release notes, download section, Android APK), so it never shows up half-finished; if a step fails it stays a draft — re-run the failed jobs, or publish it by hand. The same workflow run rewrites the GitHub Release notes into human-readable highlights and breaking changes using [GitHub Models](https://docs.github.com/en/github-models) (the raw commit-level changelog stays in a collapsed section, and `CHANGELOG.md` is untouched; if the model call fails the release simply keeps the auto-generated notes), credits everyone who took part — commit and pull request authors (flagging first-time contributors) and the reporters of issues the release closes, leaving out bots and AI accounts, and crediting the maintainer only for commits or pull requests they authored, not for merging (`.github/scripts/release-thanks.sh`) — and builds and publishes a versioned backend image to `ghcr.io/timvanonckelen/famlin`, which is what `docker-compose.yml` runs by default — see [Server setup](/server-setup) and [Maintenance](/maintenance#building-from-source-instead) if you need to build from source instead.

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
