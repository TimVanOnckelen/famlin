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
| `auth.ts` | `/api/auth` | Generic OIDC (`/oidc`, `/oidc-config`) + local password login, `/me`, register/reset (admin) |
| `groups.ts` | `/api/groups` | Read-only, member-facing: your groups, group detail, member list |
| `admin.ts` | `/api/admin` | All admin mutations: users, groups CRUD, membership, settings, cross-group content moderation (`/content/posts`, `/content/comments`, restore) |
| `posts.ts` | `/api/posts` | CRUD, always filtered by group membership |
| `comments.ts`, `likes.ts`, `favorites.ts` | `/api` | Comments, likes, and favorites (`POST /posts/:postId/favorite` to toggle, `GET /favorites` for the logged-in user's bookmarked posts). `GET /posts/:postId/comments` accepts an optional `?assetUrl=` filter and `POST` accepts an optional `assetUrl` body field to pin a comment to one photo/video in the post instead of the post as a whole (replies inherit their parent's `assetUrl`) |
| `push-tokens.ts` | `/api/push-tokens` | `POST` registers this device's Expo push token; `DELETE` (called on logout) unregisters it |
| `notifications.ts` | `/api/notifications` | In-app notification history |
| `uploads.ts` | `/api/uploads` | Direct photo upload to a Docker volume, served at `/uploads/`; `GET /media-token` issues the short-lived token clients use to read it (see [Photos and uploads](#photos-and-uploads)) |
| `invites.ts` | `/api/invites` | Public invite preview (`GET /:token`), self-service registration (`POST /:token/register`), and join-for-an-already-authenticated-user (`POST /:token/accept`). Invite creation/listing/revocation lives in `admin.ts` (`/api/admin/groups/:id/invites`, `/api/admin/invites/:id`) |
| `invite-landing.ts` | `/invite/:token` (no `/api` prefix) | Public server-rendered HTML page a shared invite link opens; hands off to the app via `famlin://invite/:token?server=...`. Matches the app's design (logo, teal palette), is translated using the server's `defaultLanguage` setting, and shows App Store/Google Play buttons if `appStoreUrl`/`playStoreUrl` are set |

Services live in `backend/src/services/` (`settings.ts`, `notifications.ts`, `invites.ts`, `users.ts`, `groups.ts`, `posts.ts`, `pagination.ts`).

List endpoints that can grow large (`GET /api/posts`, `GET /api/favorites`, and the admin users/content-moderation endpoints) are cursor-paginated: they accept `?cursor=` and `?take=` (default 30, max 100) and respond with `{ items, nextCursor }` instead of a bare array. `services/pagination.ts` has the shared `paginationArgs`/`paginate` helpers.

## Data model

The Prisma schema defines `User`, `Setting`, `Group`, `GroupMember`, `Post`, `Comment`, `Like`, `Favorite`, `PushToken`, `Notification`, and `Invite`.

Key choices:

- `GroupMember` is a many-to-many join table (`@@unique([groupId, userId])`).
- Every `Post` belongs to exactly one `Group`.
- `Favorite` is a user's personal bookmark on a post (`@@unique([postId, userId])`), the same shape as `Like` but with its own overview (`GET /api/favorites`) instead of a public count.
- `User.isAdmin` guards admin-only actions. The admin UI refuses to demote or remove the last remaining admin (`isLastAdmin` in `routes/admin.ts`).
- `User` is soft-deleted (`deletedAt`, nullable) rather than removed — `DELETE /api/admin/users/:id` deactivates the account instead of deleting the row, so their existing posts/comments/photos stay intact (mirrors the `Post`/`Comment` convention below). A deactivated user can't authenticate; `POST /api/admin/users/:id/restore` reactivates them.
- `User.tokenVersion` is embedded in every JWT and checked on every authenticated request; incrementing it (on password change/reset, or when an account is deactivated) immediately invalidates every token issued before that point, without needing a token blocklist.
- `Setting` stores runtime configuration such as the OIDC issuer/client ID, allowed emails, SMTP credentials, the server's `defaultLanguage`, and optional `appStoreUrl`/`playStoreUrl` (blank by default — Famlin has no single public store listing, since each deployment distributes its own build).
- `Post` and `Comment` are soft-deleted (`deletedAt` / `deletedById`, both nullable). Every member-facing read filters `deletedAt: null`; an admin can browse everything (including removed content) and restore it via the admin UI's Content page.
- `Comment.assetUrl` (nullable) pins a comment to one entry in the post's `uploadedAssetUrls` instead of the post as a whole — `null` means a post-level comment. Used by the mobile image viewer's per-photo comment thread.
- `Invite` is a single-use, optionally-expiring, optionally-email-restricted token an admin generates per group (admin UI: Groups page). A valid invite is its own authorization: it lets `POST /api/auth/oidc` and `POST /api/auth/login` provision/join a user even when their email isn't on the `allowedEmails` whitelist (see `plugins/auth.ts`'s `verifyOidcToken(idToken, { allowUnlisted })`), and it lets `POST /api/invites/:token/register` create a local account without going through the normally admin-only `POST /api/auth/register`.

## Configuration

Runtime config lives in the database, not in `.env`. Only `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, and `TRUST_PROXY` are startup environment variables — see [Server setup](/docs/server-setup) for `TRUST_PROXY`. `getAllSettings()` (in `services/settings.ts`) caches the `Setting` table in memory for 10s, invalidated immediately on `updateSettings()`, since it's read on nearly every request.

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

`/uploads/*` is not public: an `onRequest` hook in `app.ts` requires either a normal session token (`Authorization` header) or a **media token** before `@fastify/static` serves the file. A media token is a separate, narrower-scope JWT (`scope: 'media'`, 7-day expiry, `createMediaToken`/`verifyMediaToken` in `plugins/auth.ts`) issued via `GET /api/uploads/media-token` — clients fetch one on login and pass it as a `?token=` query param (mobile: `getUploadUrl()` in `api/uploads.ts`), since `<Image>`/video sources can't attach custom headers. It's deliberately not the main session token, so it isn't the thing exposed in every image URL / proxy log.

## Notifications

- **In-app push** via Expo's push service (requires a development/production build).
- **Email notifications** via Nodemailer + SMTP, configurable per user with `emailNotificationsEnabled`.

Both respect group membership: only members of the relevant group are notified.
