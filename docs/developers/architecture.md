---
sidebar_position: 2
---

# Architecture

Famlin is a monorepo with three parts:

- **`backend/`** — Fastify + TypeScript + Prisma + Postgres API (ESM).
- **`backend/admin/`** — React + Vite admin UI, built into `backend/dist/admin/` and served by the backend at `/admin`.
- **`mobile/`** — Expo / React Native app for iOS and Android.
- **`docs/`** — Docusaurus documentation site (this website).

## Backend routes

| File | Prefix | Notes |
| --- | --- | --- |
| `auth.ts` | `/api/auth` | Generic OIDC (`/oidc`, `/oidc-config`) + local password login, `/me`, register/reset (admin), first-run admin bootstrap (`/setup-status`, `/setup`), public `/server-info` (`{ version }` from the backend's `package.json`, shown in the mobile app's profile screen). `/oidc/exchange`, `/oidc/mobile-callback`, and `/oidc/mobile-handoff` support providers (e.g. Google) that require a client secret — see [OIDC / client-secret providers](#oidc--client-secret-providers) below |
| `groups.ts` | `/api/groups` | Read-only, member-facing: your groups, group detail, member list |
| `admin.ts` | `/api/admin` | All admin mutations: users, groups CRUD, membership, settings, cross-group content moderation (`/content/posts`, `/content/comments`) |
| `posts.ts` | `/api/posts` | CRUD, always filtered by group membership. Also `GET /search?groupId=&q=` (case-insensitive search over `content`/`milestoneTag`) and `GET /on-this-day?groupId=` (posts from today's month/day in a prior year) — both registered before the dynamic `GET /:id` route |
| `comments.ts`, `likes.ts`, `favorites.ts` | `/api` | Comments, likes, and favorites (`POST /posts/:postId/favorite` to toggle, `GET /favorites` for the logged-in user's bookmarked posts). `GET /posts/:postId/comments` accepts an optional `?assetUrl=` filter and `POST` accepts an optional `assetUrl` body field to pin a comment to one photo/video in the post instead of the post as a whole (replies inherit their parent's `assetUrl`). `POST` also accepts an optional `mentionedUserIds` array (the client resolves "@name" against the group member list; the server re-validates membership and sends a `mention` notification instead of the generic `new_comment` one). Both `like` endpoints accept an optional `{ type }` body (a `ReactionType`, default `LIKE`) — see [Data model](#data-model) |
| `push-tokens.ts` | `/api/push-tokens` | `POST` registers this device's Expo push token; `DELETE` (called on logout) unregisters it |
| `notifications.ts` | `/api/notifications` | In-app notification history |
| `uploads.ts` | `/api/uploads` | Direct photo upload to a Docker volume, served at `/uploads/`; `GET /media-token` issues the short-lived token clients use to read it (see [Photos and uploads](#photos-and-uploads)) |
| `immich.ts` | `/api/immich` | Read-only, member-facing: `GET /groups/:groupId/albums` (a group's linked Immich albums), `GET /albums/:linkId/assets` (asset list with proxy URLs), `GET /assets/:linkId/:assetId/:variantExt` (streams a rendition from Immich, gated the same dual-auth way as `/uploads/*` plus a check that the asset actually belongs to the linked album). Linking/unlinking albums to a group is an admin mutation and lives in `admin.ts` instead (see [Immich integration](#immich-integration)) |
| `invites.ts` | `/api/invites` | Public invite preview (`GET /:token`), self-service registration (`POST /:token/register`), and join-for-an-already-authenticated-user (`POST /:token/accept`). Invite creation/listing/revocation lives in `admin.ts` (`/api/admin/groups/:id/invites`, `/api/admin/invites/:id`) |
| `invite-landing.ts` | `/invite/:token` (no `/api` prefix) | Public server-rendered HTML page a shared invite link opens; hands off to the app via `famlin://invite/:token?server=...`. Matches the app's design (logo, teal palette), is translated using the server's `defaultLanguage` setting, and shows App Store/Google Play buttons if `appStoreUrl`/`playStoreUrl` are set |
| `landing.ts` | `/` (no `/api` prefix) | Public server-rendered HTML landing page confirming the server is running, styled to match the invite landing page. Shares its HTML shell (`utils/html-page.ts`) with `invite-landing.ts` |

Services live in `backend/src/services/` (`settings.ts`, `notifications.ts`, `invites.ts`, `users.ts`, `groups.ts`, `posts.ts`, `comments.ts`, `reactions.ts`, `onThisDay.ts`, `pagination.ts`). `src/jobs/onThisDay.ts` runs daily via `node-cron` (scheduled in `server.ts`, not `app.ts`, so the test suite's `buildApp()` never triggers it) and sends each group a notification about posts made on that day in a previous year.

**There is no seeded/default admin account.** `GET /api/auth/setup-status` returns `{ needsSetup: boolean }` — `true` iff the `User` table is empty — and the admin UI (`SetupPage.tsx`) shows a one-time account-creation screen instead of the login form while that holds. `POST /api/auth/setup` provisions that first account as an admin and only ever succeeds once: it runs inside a transaction holding a Postgres advisory lock (`pg_advisory_xact_lock`, see `SETUP_ADVISORY_LOCK_KEY` in `routes/auth.ts`) around a `user.count()` check, so two concurrent requests can't both pass the check and create two accounts — the loser gets `409`. `prisma/seed.ts` (`db:seed`) is a separate, dev/test-only fixture script (fake family members, sample posts, and a hardcoded `admin@example.com`/`test123456` account) — it's never invoked by the production Docker image or `prisma migrate deploy`, so don't rely on it for a real deployment's first-run flow.

List endpoints that can grow large (`GET /api/posts`, `GET /api/favorites`, and the admin users/content-moderation endpoints) are cursor-paginated: they accept `?cursor=` and `?take=` (default 30, max 100) and respond with `{ items, nextCursor }` instead of a bare array. `services/pagination.ts` has the shared `paginationArgs`/`paginate` helpers.

## Data model

The Prisma schema defines `User`, `Setting`, `Group`, `GroupMember`, `Post`, `Comment`, `Like`, `Favorite`, `PushToken`, `Notification`, `Invite`, and `ImmichAlbumLink`.

Key choices:

- `GroupMember` is a many-to-many join table (`@@unique([groupId, userId])`).
- Every `Post` belongs to exactly one `Group`.
- `Favorite` is a user's personal bookmark on a post (`@@unique([postId, userId])`), the same shape as `Like` but with its own overview (`GET /api/favorites`) instead of a public count.
- `Like` is a reaction, not a plain boolean: `type` (`ReactionType`: `LIKE`/`LOVE`/`HAHA`/`WOW`/`SAD`/`CARE`, default `LIKE`) holds which emoji a user picked. The `@@unique([postId, userId])`/`@@unique([commentId, userId])` constraints still cap it at one reaction per user per post/comment — switching reactions updates that row instead of adding a second one, and tapping the same reaction again deletes it.
- `Notification.type` is a plain string, not a DB enum — the closed set of values (`new_post`, `new_comment`, `new_like_post`, `new_like_comment`, `mention`, `on_this_day`) lives in `NotifyType` in `services/notifications.ts`, along with which of `User`'s six email/push preference columns each type checks. `mention` and `on_this_day` reuse the comment/post columns rather than adding two more.
- `User.isAdmin` guards admin-only actions. The admin UI refuses to demote or remove the last remaining admin (`isLastAdmin` in `routes/admin.ts`).
- `User`, `Post`, and `Comment` are all hard-deleted — there's no `deletedAt` column on any of them. `DELETE /api/admin/users/:id` calls `prisma.user.delete`, which cascades to remove that user's posts, comments, likes, favorites, and notifications immediately (`onDelete: Cascade` on the relevant relations). `DELETE /api/posts/:id`/`DELETE /api/comments/:id` are permanent the same way. None of these can be undone — there's no restore.
- `User.tokenVersion` is embedded in every JWT and checked on every authenticated request; incrementing it (on password change/reset) immediately invalidates every token issued before that point, without needing a token blocklist.
- `Setting` stores runtime configuration such as the OIDC issuer/client ID, allowed emails, SMTP credentials, the server's `defaultLanguage`, and optional `appStoreUrl`/`playStoreUrl`. `appStoreUrl` is blank by default (no single iOS listing — each deployment distributes its own build). `playStoreUrl` defaults to the official pre-built Android app (`https://play.google.com/store/apps/details?id=be.xeweb.famlin`, see `DEFAULT_PLAY_STORE_URL` in `services/settings.ts`) whenever the setting has never been saved — an admin can still blank it out explicitly to hide the download button.
- `Comment.assetUrl` (nullable) pins a comment to one entry in the post's `uploadedAssetUrls` instead of the post as a whole — `null` means a post-level comment. Used by the mobile image viewer's per-photo comment thread.
- `Invite` is a single-use, optionally-expiring, optionally-email-restricted token an admin generates per group (admin UI: Groups page). A valid invite is its own authorization: it lets `POST /api/auth/oidc` and `POST /api/auth/login` provision/join a user even when their email isn't on the `allowedEmails` whitelist (see `plugins/auth.ts`'s `verifyOidcToken(idToken, { allowUnlisted })`), and it lets `POST /api/invites/:token/register` create a local account without going through the normally admin-only `POST /api/auth/register`.
- `ImmichAlbumLink` links one Immich album to one Famlin group (`@@unique([groupId, immichAlbumId])`) — see [Immich integration](#immich-integration).

## Configuration

Runtime config lives in the database, not in `.env`. Only `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, and `TRUST_PROXY` are startup environment variables — see [Server setup](/docs/server-setup) for `TRUST_PROXY`. `getAllSettings()` (in `services/settings.ts`) caches the `Setting` table in memory for 10s, invalidated immediately on `updateSettings()`, since it's read on nearly every request.

## OIDC / client-secret providers

The default OIDC flow (`POST /oidc`) is a public-client PKCE exchange the client (admin browser or mobile app) does directly against the provider, with `redirect_uri` on that client's own origin (`https://.../admin/` or the app's `famlin://` scheme) — no secret ever touches Famlin's backend. Authentik/Keycloak/Auth0-style self-hosted providers support this.

Google does not: its OAuth clients require a `client_secret` for the code→token exchange, and its native/"iOS"/"Android" client types force redirect_uri onto a Google-generated `com.googleusercontent.apps.<id>` scheme rather than the app's own — a hard blocker for Famlin's mobile app specifically, since it ships one shared pre-built binary (`be.xeweb.famlin` on Google Play) used by many independent self-hosted deployments, each with a different Google OAuth client and therefore a different mandated scheme; the scheme can't be baked into the shared binary per-deployment. The fix is an optional `oidcClientSecret` setting (`services/settings.ts`) that switches both surfaces to a server-mediated exchange, letting Google be configured as a single ordinary **Web application** OAuth client instead:

- **Admin UI**: unchanged redirect (`https://.../admin/`, a real HTTPS URL Google already accepts) — but instead of exchanging the code itself, the SPA POSTs `{ code, redirectUri, codeVerifier }` to `POST /oidc/exchange`, which holds the secret and does the exchange server-side (`LoginPage.tsx`, gated on `oidcConfig.usesClientSecret` from `GET /oidc-config`).
- **Mobile app**: can't use an HTTPS `redirect_uri` directly — the OS won't hand control back to the app for a plain HTTPS redirect (no universal links/App Links setup). Instead the authorize request's `redirect_uri` is `mobileCallbackUrl` (`GET /oidc-config`'s `${origin}/api/auth/oidc/mobile-callback`, under the deployment's own domain, which Google is happy to accept), and `GET /oidc/mobile-callback` completes the login server-side, then 302s to `famlin://oidc-callback?handoff=<code>` — a scheme the app already owns and `WebBrowser.openAuthSessionAsync` is watching for (`utils/oidcLogin.ts`). The Famlin session token isn't put directly in that redirect's query string (would leak into the server's own access logs); instead it's stashed in a short-lived, single-use, in-memory handoff (`services/oidcHandoff.ts`, 2-minute TTL) that the app immediately redeems via `POST /oidc/mobile-handoff`.
- An in-progress invite claim (`InviteScreen.tsx`'s SSO button) has no session to travel through for the mobile flow, so it's round-tripped through the OAuth `state` parameter as plain JSON (`{"inviteToken":"..."}`) instead — trust here matches the existing direct-PKCE flow, which already accepts a client-supplied `inviteToken` unsigned, since the invite's own validity check is what's actually authoritative server-side.
- `completeOidcLogin()` (`services/oidcLogin.ts`) is the shared user-provisioning/token-issuing logic behind all three entry points (`POST /oidc`, `POST /oidc/exchange`, `GET /oidc/mobile-callback`), so the invite/allowedEmails/account-creation rules only exist once.

## Authorization rules

- Group membership is the core authorization rule. Every posts query must filter on groups the logged-in user belongs to — `services/groups.ts`'s `isGroupMember(groupId, userId)` is the shared check most routes use.
- Group mutations live only in `admin.ts` and require `isAdmin`.
- `requireAdmin` returns a boolean and sends the 403 itself. Callers must `return` when it returns `true`.
- The global error handler (`app.ts`) maps a thrown `ZodError` to a `400` and hides any other unhandled error behind a generic translated message — route handlers shouldn't leak `err.message` to the client for anything that isn't already a deliberately user-facing, translated string.

## Internationalization

Both the mobile app and the admin UI use `i18next` + `react-i18next`. Locales live in:

- `mobile/src/i18n/locales/{en,nl}.json`
- `backend/admin/src/i18n/locales/{en,nl}.json`

`en.json` is the source, `nl.json` the translation. `fallbackLng` is `en`.

## Photos and uploads

Photos are uploaded directly to the Famlin backend (`POST /api/uploads`) and stored in a Docker volume (`famlin-uploads`). `uploadedAssetUrls`/`assetUrl` fields are validated against the exact `/uploads/<uuid>.<ext>` shape the upload route writes, so a post/comment can't reference an arbitrary external URL.

`/uploads/*` is not public: an `onRequest` hook in `app.ts` requires either a normal session token (`Authorization` header) or a **media token** before `@fastify/static` serves the file. A media token is a separate, narrower-scope JWT (`scope: 'media'`, 7-day expiry, `createMediaToken`/`verifyMediaToken` in `plugins/auth.ts`) issued via `GET /api/uploads/media-token` — clients fetch one on login and pass it as a `?token=` query param (mobile: `getUploadUrl()` in `api/uploads.ts`), since `<Image>`/video sources can't attach custom headers. It's deliberately not the main session token, so it isn't the thing exposed in every image URL / proxy log. Both token types are checked against the DB in that hook (`isSessionCurrent`), so — like every other authenticated request — a deleted account or a token from before a password change/reset loses `/uploads` access immediately rather than at natural token expiry; the media token embeds the user's `tokenVersion` at issue time so it's revoked the same way. `authenticateMediaRequest()` in `plugins/auth.ts` factors this check out so `routes/immich.ts`'s asset proxy (below) can reuse it verbatim instead of duplicating the header/query-token logic.

## Immich integration

Rather than every family member creating and managing their own Immich API key, Famlin uses one server-level Immich connection (server URL + API key, set in the admin UI's Server Settings, stored in `Setting` like the OIDC config) that an admin uses to link specific Immich albums to specific Famlin groups (`ImmichAlbumLink`, admin UI: Groups page). Linking is an admin mutation (`POST`/`DELETE /api/admin/groups/:id/immich-albums`, `.../immich-albums/:id`) — regular members never see an Immich login, token, or API key.

`services/immich.ts` wraps the Immich REST API (`x-api-key` auth) and throws a typed `ImmichError` (`not_configured`/`unreachable`/`unauthorized`) the same way `plugins/auth.ts`'s `OidcError` does, so routes can map it to a translated message instead of leaking fetch internals; `immichErrorKey()`/`immichErrorStatus()` are the single mapping every route (`routes/immich.ts`, `routes/admin.ts`) imports rather than re-deriving.

An Immich-sourced photo is represented as just another string in `Post.uploadedAssetUrls` — a proxy URL shape (`/api/immich/assets/<linkId>/<assetId>/<variant>.<ext>`) rather than the usual `/uploads/<uuid>.<ext>` one, validated by `parseImmichAssetPath()`/a second regex alongside the upload-path one in `types.ts` — the single place that shape is defined, reused by the zod validator, `routes/immich.ts`'s `:variantExt` check, and `routes/posts.ts`'s cross-group check. Because it's "just another asset URL," every feature that already operates on `uploadedAssetUrls` — feed rendering, the image viewer, per-photo comment pinning (`Comment.assetUrl`) — needs no Immich-specific code. Unlike an upload path, the extension here reflects the real bytes each variant streams: `thumbnail`/`preview` are always `.jpg` (Immich's thumbnail endpoint never returns video, even for a video asset), while `original` is `.jpg` or `.mp4` matching the asset's real type — that's also why the mobile picker attaches `originalUrl` (not `previewUrl`) for a video, so `isVideoUrl()` and the `<Video>` player it feeds get an actually-playable file.

Authorization for the proxy route (`GET /api/immich/assets/:linkId/:assetId/:variantExt`) resolves `linkId → groupId`, checks the requester is a member of that group, and then calls `isAssetInAlbum()` (`services/immich.ts`) to confirm the requested `:assetId` is actually one of that album's assets — a 60-second in-memory cache (single-instance, matching `getAllSettings()`'s settings cache) keeps this from re-querying Immich per grid tile. That last check matters because the server-level API key can read any asset on the whole Immich instance: without it, a member who learns an asset id from elsewhere (e.g. another group's post) could read assets from albums never linked to Famlin at all, not just ones linked to a different group. `routes/posts.ts`'s `POST /` additionally checks, for any Immich URL in `uploadedAssetUrls`, that the URL's embedded `linkId` belongs to the post's own `groupId` — otherwise a member of one group could attach another group's linked album photos to a post in a group they share only incidentally.

## Notifications

- **In-app push** via Expo's push service (requires a development/production build).
- **Email notifications** via Nodemailer + SMTP, configurable per user with `emailNotificationsEnabled`.

Both respect group membership: only members of the relevant group are notified.
