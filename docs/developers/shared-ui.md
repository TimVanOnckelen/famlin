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
Viewport breakpoints stay numeric in the native export and map to CSS pixels in
`tokens.css` (today: `breakpoint.mobile: 720`). Browser semantic aliases for shadcn
live in `packages/ui/styles.css`, while shared
brand values are generated into `tokens.css`. Generated files must not be edited manually.

## Responsive behavior

The mobile/desktop cut-over is 720px everywhere (`breakpoint.mobile`). Tailwind
cannot use CSS variables inside `@media`, so `packages/ui/styles.css` pins
`--breakpoint-md: 45.0625rem` (721px, the first desktop pixel) — keep it
in sync with the token.

- `Sheet` (`@famlin/ui/sheet`) and `Drawer` (`@famlin/ui/drawer`) are the
  shadcn base-nova components (sources mirrored from the shadcn registry, Base
  UI Dialog / Base UI Drawer under the hood). `Sheet` is a side drawer for
  navigation (`side="left|right|top|bottom"`); `Drawer` is a swipeable sheet
  (`swipeDirection`, snap points, swipe handle) — on mobile dialogs and for
  bottom sheets.
- `ResponsiveDialog` (`@famlin/ui/common/responsive-dialog`) is the packaged
  [shadcn responsive-dialog pattern](https://ui.shadcn.com/docs/components/base/drawer#responsive):
  it renders a `Dialog` on desktop and a `Drawer` bottom sheet on mobile, so
  consumers write one self-adapting tree — the media switch (720px, from
  `@famlin/design-tokens` via `useMediaQuery`, `@famlin/ui/hooks/use-media-query`)
  lives inside the component. Admin's `AdminModal` is the reference consumer.
  `Dialog` itself stays the classic centered box at every width.
- Drive the root's `open` state instead of mounting it already
  open: Base UI only runs entrance/exit transitions on real open changes, so a
  popup that mounts open never animates in and one whose parent unmounts on
  close never animates out (`onOpenChangeComplete(false)` is the moment to
  unmount). The mobile branch of `ResponsiveDialog` handles this choreography
  internally.
- `Drawer` consumers need `body { position: relative }` (iOS Safari overlay) —
  admin's stylesheet sets it.
- `Table` adapts at the cut-over: give each `TableCell` a `data-label`. At widths
  ≤720px the header remains available to screen readers and every row renders
  as a stacked card — label/value
  pairs (`data-label` shown via a `::before`), with a label-less cell becoming
  the row actions grouped at the bottom of the card. The first field spans the
  card width; other fields use a two-column grid with wrapping values and
  subtle separators. Values share one wrapper so mixed text and badges stay
  together. Cells with `colSpan` remain ordinary full-width content.
- Esc, backdrop press and focus trapping come from Base UI; closing a sheet on
  in-drawer navigation is the consumer's job (`onClick` on the nav items), as
  admin's `Layout` does.

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

Workspace consumers share the root React/React DOM installation; admin needs no React type path overrides or Vite dedupe configuration. No JavaScript library build is required: Vite consumes TS/TSX source exports.

Mobile can consume the resolved TypeScript export separately; the JSON source is a schema with references, not a ready-to-use native theme. Browser components
are not React Native components; a future native UI package is a separate
architecture decision.

The Docker frontend stage uses one root workspace install and builds both frontends under `/repo`. Production assets stay at `dist/admin` and `dist/web`, served at `/admin/` and `/`. The development stage retains `/repo` and mounts the repository there, so shared components participate in admin's watch-build without relocated package links.

## UI dependency policy

`shadcn` is a development-only CLI/CSS build dependency. Production UI dependencies must not include the CLI toolchain. The shared `cn` helper uses `clsx` and `tailwind-merge`; import it relatively within the library. The Toaster accepts Sonner's `theme` prop (default `system`) and does not require a ThemeProvider or `next-themes`; each application chooses its theme explicitly.

The independent backend install uses `install-strategy=shallow` in `backend/.npmrc` to keep transitive tools such as Prisma Studio (and their React dependencies) below their owning packages. Preserve this isolation: `backend/admin` must resolve React from the root workspace, not a parent backend tooling installation. The backend lockfile retains the existing package versions with the nested layout.
