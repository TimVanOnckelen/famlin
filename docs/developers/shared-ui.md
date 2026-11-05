# Shared design tokens and browser UI

`packages/design-tokens` owns the JSON token source, typed TypeScript exports,
and committed generated CSS. It has no React or browser dependency.
`packages/ui` owns browser primitives and application-independent compositions.
Admin is the first consumer; web and mobile have not been migrated.

## Install and validate

Keep the repository structure when working with local `file:` dependencies:

```sh
npm ci
npm --prefix backend/admin ci
npm run check --workspace=@famlin/design-tokens
npm run typecheck --workspace=@famlin/ui
npm run lint --workspace=@famlin/ui
npm run test --workspace=@famlin/ui
npm --prefix backend/admin test
npm --prefix backend/admin run lint
npm run build:admin
```

Edit `packages/design-tokens/src/tokens.json`, then run
`npm run generate --workspace=@famlin/design-tokens` and commit `tokens.css`.
The initial brand colors match `design/styleguide.html`; existing admin semantic
colors, shadows and radius remain unchanged. Layout settings such as sidebar
width belong to the application. This extraction does not normalize mobile or
web token differences.

Import components through explicit subpaths:

```tsx
import { Button } from '@famlin/ui/button'
import { SectionCard } from '@famlin/ui/common/section-card'
import { AuthShell } from '@famlin/ui/common/auth-shell'

<AuthShell logo={<YourLogo />}>...</AuthShell>
```

Pass translated text and callbacks from the application. `UserAvatar` accepts
`name`, `src` and `className`; admin's `InitialAvatar` retains authenticated
loading, session-scoped cache, request deduplication and object URL cleanup.

## Checks and ownership

CI's Admin UI job checks generated tokens, shared UI types/lint/tests, admin's
cache tests and lint, and the admin typecheck/build. Presentation and keyboard
interaction tests live in `packages/ui/tests`; protected-image cache tests stay
in `backend/admin/tests`. Check Select inside Dialog, focus restoration, Tabs
keyboard activation and reduced motion when changing control behavior. DOM
tests cover interaction contracts; use a browser to verify actual layout and
animation when available.

## Add primitives

Run the shadcn CLI from the shared package using its `components.json`:

```sh
cd packages/ui
npx shadcn add <component>
```

Add its explicit export to `package.json` and use relative imports within the
package, following the existing components. Admin's CLI aliases also point to
the shared package. Do not import application modules into UI.

## Connect web later

Add a dependency on `@famlin/ui` and `@famlin/design-tokens`. Import
`@famlin/ui/styles.css` after `tailwindcss` in the application stylesheet and
explicitly register the library with `@source '../../packages/ui/src'` (path
relative to that stylesheet). Keep reset, body and page layout styles in the
application. Tailwind's [source registration documentation](https://tailwindcss.com/docs/detecting-classes-in-source-files)
explains scanning dependencies. Load Nunito in the application as admin does.

Set Vite `resolve.dedupe` to `['react', 'react-dom']`. Independently installed
consumers also need TypeScript `react` / `react/*` paths pointing to their own
`@types/react` to keep source components and JSX on one type identity; see
admin's `tsconfig.json`. No JavaScript library build is required: Vite consumes
TS/TSX source exports.

Mobile can consume the JSON/TypeScript tokens separately. Browser components
are not React Native components; a future native UI package is a separate
architecture decision.

The Docker frontend stage installs the root workspace and admin dependencies,
builds both frontends under `/repo`, and copies assets to `dist/admin` and
`dist/web`; production URL prefixes stay `/admin/` and `/`.

The Docker development overlay also mounts `packages/` so changes to shared
components participate in the existing admin watch-build.
