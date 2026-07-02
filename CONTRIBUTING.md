# Contributing to Famlin

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

Every pull request runs through CI (GitHub Actions): typecheck and build for the backend, admin UI, mobile app, and docs site, plus a Postgres-backed check that Prisma migrations apply cleanly. All checks must pass before a PR can be merged. The PR template also asks you to confirm `npx tsc --noEmit` passes in every package you touched and that i18n keys were added in both `en` and `nl` locales for any UI string changes.

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...) for commit and PR titles — [release-please](https://github.com/googleapis/release-please) reads them to generate the changelog and version bump automatically, so a clear prefix helps your change show up correctly in the next release.

## Releases

Famlin uses release-please to automate versioning and changelogs. Merging to `main` keeps an open release pull request up to date; merging that PR cuts a GitHub Release tagged `vX.Y.Z`. That tag triggers a build that publishes a versioned backend image to `ghcr.io/timvanonckelen/famlin` — see [docs/docs/server-setup.md](docs/docs/server-setup.md) for running a published image instead of building from source.

## Development setup

See [README.md](README.md) for the quick start. In short:

```bash
cp .env.example .env
# Edit .env and set JWT_SECRET
docker compose up --build
```

## Code style

- Use TypeScript for backend and admin code.
- Follow the existing project structure and naming conventions described in [CLAUDE.md](CLAUDE.md).
- Keep commits focused and write clear commit messages.

## Communication

Please be respectful and constructive in all interactions. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## License

By contributing to Famlin, you agree that your contributions will be licensed under the [MIT License](LICENSE).
