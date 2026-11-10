# Shared design tokens and browser UI

`packages/design-tokens` owns the JSON token source, typed TypeScript exports,
and committed generated CSS. It has no React or browser dependency.
`packages/ui` owns browser primitives and application-independent compositions.
Admin is the first consumer; web and mobile have not been migrated.

## Install and validate

Admin, web and shared packages are root npm workspace members. Install once from the root lockfile:

```sh
npm ci
npm run check --workspace=@famlin/design-tokens
npm run test --workspace=@famlin/design-tokens
npm run typecheck --workspace=@famlin/ui
npm run lint --workspace=@famlin/ui
npm run test --workspace=@famlin/ui
npm test --workspace=famlin-admin
npm run lint --workspace=famlin-admin
npm run build:admin
```

Edit `packages/design-tokens/src/tokens.json`, then run
`npm run generate --workspace=@famlin/design-tokens` and commit `tokens.css` and `src/generated.ts`.
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

## Platform-independent token contract

`src/tokens.json` contains colors, numeric dimensions in logical units, a font
family, structured shadows and gradients. References use `{ "ref": "color.primary" }`;
the generator resolves them and rejects missing/circular references and CSS expressions.
Do not put `var()`, `px`, `rem` or CSS gradient strings in this source.

The package root and `@famlin/design-tokens/native` export the same resolved,
readonly TypeScript values with literal types. For example, a future React Native
consumer can use `tokens.color.primary` as `backgroundColor` and
`tokens.radius.control` as `borderRadius` directly in `StyleSheet.create`.
No CSS parsing or React/browser dependency is required. Mobile is not migrated here.

Shadows and gradients are structured design data, not complete React Native styles:
platform adapters choose supported shadow/gradient APIs. Font loading and browser
fallbacks also belong to platform layers. Numeric dimensions map to CSS pixels;
spacing maps to rem using a 16px reference and stays numeric in the native export.
Browser semantic aliases for shadcn live in `packages/ui/styles.css`, while shared
brand values are generated into `tokens.css`. Generated files must not be edited manually.

## Checks and ownership

CI's Admin UI job checks generated tokens, shared UI types/lint/tests, admin's
cache tests and lint, and the admin typecheck/build. Presentation and keyboard
interaction tests live in `packages/ui/tests`; protected-image cache tests stay
in `backend/admin/tests`. Check Select inside Dialog, focus restoration, Tabs
keyboard activation and reduced motion when changing control behavior. DOM
tests cover interaction contracts; use a browser to verify actual layout and
animation when available.

## Responsive patterns

Every `@famlin/ui` component has to work on a 360px-wide phone; check that when
you review a new or changed one. The compact layout applies below the
`breakpoint.desktop` token (721 logical px, so ≤720px). The generator emits it
as a Tailwind theme breakpoint, which gives the `desktop:` and `max-desktop:`
variants; use those (or `@variant max-desktop { … }` in CSS) instead of a
hard-coded `@media` width. In TypeScript, `useCompactLayout()` from
`@famlin/ui/lib/use-compact-layout` matches the same width. Use it only where
markup has to differ, and style with the variants otherwise.

| Pattern | Use |
| --- | --- |
| `NavShell` (`@famlin/ui/common/nav-shell`) | The app frame. On desktop it renders the `sidebar` node in an `<aside>`. On compact screens it shows a top header (the `brand` node and a menu button) and opens the sidebar as a modal drawer: focus is trapped, and the drawer closes on Esc, a backdrop tap, its close button or a followed link. The app passes the translated `menuLabel`/`openMenuLabel`/`closeMenuLabel` and owns the sidebar's look through `sidebarClassName`. |
| `<Table stacked>` | Shows each row as a card of label/value pairs on compact screens. Give every `TableCell` a `label` (normally its column header). Leave the label off the one cell that identifies the row, which becomes the card's title, and put row buttons in a `TableActionsCell`. The card styles live in `styles.css`. They are unlayered on purpose, so they override utilities a page sets on cells. |
| `DialogContent` + `DialogHeader` / `DialogBody` / `DialogActions` | A centered dialog on desktop and a fullscreen sheet on compact screens. The header stays at the top, and `DialogActions` is a full-width bar fixed to the bottom of the screen. Put it last inside `DialogBody`, or inside a form in it, so the close button and primary action stay visible however long the content is. |

Other compact-screen rules: every button size and switch/checkbox hit area is at
least 44×44px, and inputs and selects use a 16px font so iOS doesn't zoom in on
focus.

Admin uses all three, and its 360px layout is tested in a browser by
`e2e/tests/admin-mobile.spec.ts` (see the e2e section of the quick start). DOM
tests for the drawer, stacked table and sheet live in
`packages/ui/tests/responsive.test.tsx`.

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

Workspace consumers share the root React/React DOM installation; admin needs no React type path overrides or Vite dedupe configuration. No JavaScript library build is required: Vite consumes TS/TSX source exports.

Mobile can consume the resolved TypeScript export separately; the JSON source is a schema with references, not a ready-to-use native theme. Browser components
are not React Native components; a future native UI package is a separate
architecture decision.

The Docker frontend stage uses one root workspace install and builds both frontends under `/repo`. Production assets stay at `dist/admin` and `dist/web`, served at `/admin/` and `/`. The development stage retains `/repo` and mounts the repository there, so shared components participate in admin's watch-build without relocated package links.

## UI dependency policy

`shadcn` is a development-only CLI/CSS build dependency. Production UI dependencies must not include the CLI toolchain. The shared `cn` helper uses `clsx` and `tailwind-merge`; import it relatively within the library. The Toaster accepts Sonner's `theme` prop (default `system`) and does not require a ThemeProvider or `next-themes`; each application chooses its theme explicitly.

The independent backend install uses `install-strategy=shallow` in `backend/.npmrc` to keep transitive tools such as Prisma Studio (and their React dependencies) below their owning packages. Preserve this isolation: `backend/admin` must resolve React from the root workspace, not a parent backend tooling installation. The backend lockfile retains the existing package versions with the nested layout.
