---
sidebar_position: 3
---

# Using the API

Every Famlin server exposes a REST API under `/api` — the same API the mobile and web apps use. With a **personal access token** you can build your own integrations on top of your family's server: a digital photo frame that shows the latest posts, a script that posts a daily photo, a home-dashboard widget with unread notifications, and so on.

The base URL is your own deployment, e.g. `https://famlin.example.com`. All examples below use `curl` and assume:

```bash
export FAMLIN_URL="https://famlin.example.com"
export FAMLIN_TOKEN="famlin_pat_..."
```

## Authentication

### Personal access tokens (recommended)

Create a token in the **web app**: open your avatar menu (top right) → **API tokens** → give it a name, optionally an expiry, and click **Create token**. The secret (`famlin_pat_...`) is shown **once** — copy it immediately; only a SHA-256 hash is stored on the server.

Send it as a standard bearer token on every request:

```bash
curl -H "Authorization: Bearer $FAMLIN_TOKEN" "$FAMLIN_URL/api/auth/me"
```

Things to know:

- A token **acts as you**: it can read and write exactly what your account can (your groups, your posts, your favorites). Treat it like a password.
- Tokens are **revocable at any time** from the same web UI (or `DELETE /api/api-tokens/:id`); revocation takes effect immediately.
- An optional expiry (set at creation) makes the token stop working after that date.
- Changing your password does **not** invalidate personal access tokens — it signs out app sessions but deliberately keeps integrations running. Revoke tokens explicitly.
- A request authenticated with a token **cannot create new tokens** (`403`) — a leaked token can't mint replacements for itself and outlive revocation. Token creation always requires an interactive login session.
- Token management is web-only by design; the mobile app has no token screen.

### Session tokens

Alternatively, `POST /api/auth/login` with your email and password returns a JWT valid for 30 days — this is what the apps themselves use. It's fine for quick experiments, but for anything long-lived prefer a personal access token: session tokens expire, and all of them are invalidated whenever you change your password.

```bash
curl -X POST "$FAMLIN_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "..."}'
# → { "token": "eyJ...", "user": { ... } }
```

Both token kinds are sent the same way (`Authorization: Bearer <token>`), and everything below works identically with either.

### Media tokens (reading photos and videos)

Files under `/uploads/*` and the Immich proxy under `/api/immich/assets/*` are auth-gated. You can read them with your normal `Authorization` header (personal access tokens work), but for contexts that can't send headers — an `<img>` tag, a video player — request a narrow-scope **media token** and append it as a query parameter:

```bash
curl -H "Authorization: Bearer $FAMLIN_TOKEN" "$FAMLIN_URL/api/uploads/media-token"
# → { "token": "eyJ..." }

# then:
#   $FAMLIN_URL/uploads/<file>.jpg?token=<media token>
```

Media tokens are valid for 7 days, can only read media (they are not a session credential), and are safe-ish to embed in URLs — that's exactly why they exist, so the full credential never lands in access logs.

## Conventions

**Requests and responses are JSON** (`Content-Type: application/json`), except file uploads (multipart) and media downloads. IDs are opaque strings (cuid). Timestamps are ISO 8601 in UTC, e.g. `"2026-07-08T09:00:00.000Z"`.

**Errors** always have the shape `{ "error": "<message>" }`. Validation failures (400) add a `details` object describing the offending fields. Error messages are translated: send `Accept-Language: nl` for Dutch (default English).

| Status | Meaning |
| --- | --- |
| `400` | Invalid body/query (see `details`) or a domain rule violation |
| `401` | Missing, invalid, expired, or revoked credential |
| `403` | Authenticated, but not allowed — usually: not a member of that group |
| `404` | Resource doesn't exist (or is deliberately indistinguishable from one you can't see) |
| `413` | Uploaded file too large |
| `429` | Rate limited |

**Rate limits:** 300 requests/minute per IP overall; `POST /api/uploads` is additionally limited to 60 uploads per 10 minutes. `429` responses include standard `retry-after` headers.

**Pagination:** list endpoints (`GET /api/posts`, `/api/posts/search`, `/api/favorites`) take `?cursor=` and `?take=` (default 30, max 100) and return:

```json
{ "items": [ ... ], "nextCursor": "cmb1..." }
```

Pass `nextCursor` back as `?cursor=` for the next page; `null` means you've reached the end.

**Authorization model:** every piece of content belongs to exactly one group (family), and you can only see or touch content in groups you are a member of. There is no way to opt out of this per token — a request for a group you're not in is a `403`. Admin-only management endpoints live under `/api/admin` and require an admin account; they're not covered here (see [Architecture](./architecture) for the full route map).

## API tokens

Manage the personal access tokens of the authenticated user.

| Method & path | Description |
| --- | --- |
| `GET /api/api-tokens` | List your tokens: `{ items: [{ id, name, tokenPreview, lastUsedAt, expiresAt, createdAt }] }`. Never contains the secret. |
| `POST /api/api-tokens` | Create a token. Body: `{ name, expiresInDays? }` (name ≤ 100 chars; expiry 1–3650 days, omit for no expiry). Returns `201` with `{ id, name, token, tokenPreview, expiresAt, createdAt }` — `token` is the secret, shown only here. **Session-authenticated requests only** (`403` when called with another API token). |
| `DELETE /api/api-tokens/:id` | Revoke one of your tokens. `404` if it isn't yours or doesn't exist. |

## Account

| Method & path | Description |
| --- | --- |
| `GET /api/auth/me` | The authenticated user, including a `groups` array of the groups they belong to. |
| `PATCH /api/auth/me` | Update your profile: `avatarUrl` (an `/uploads/...` path from the upload endpoint) and notification preferences (`emailOnNewPost`, `pushOnNewComment`, ...). |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }`. Invalidates all session tokens (not API tokens). |
| `GET /api/auth/server-info` | Public. `{ version }` of the server. |
| `GET /api/auth/notification-config` | Public. Which notification channels the server has enabled: `{ pushEnabled, emailEnabled }`. |

## Groups

Read-only — group management is an admin capability.

| Method & path | Description |
| --- | --- |
| `GET /api/groups` | Groups you belong to: `[{ id, name, description, createdAt, joinedAt }]`. |
| `GET /api/groups/:id` | One group (must be a member). |
| `GET /api/groups/:id/members` | Its members: `[{ id, name, email, avatarUrl, joinedAt }]`. |

## Posts

### The post object

```json
{
  "id": "cmb1abc...",
  "authorId": "cmb1def...",
  "author": { "id": "cmb1def...", "name": "Emma", "avatarUrl": "/uploads/....jpg" },
  "groupId": "cmb1ghi...",
  "group": { "id": "cmb1ghi...", "name": "Family Smith" },
  "content": "First day of school!",
  "type": "UPDATE",
  "milestoneTag": null,
  "uploadedAssetUrls": ["/uploads/8d0f...jpg"],
  "latitude": null,
  "longitude": null,
  "locationName": null,
  "createdAt": "2026-07-08T07:41:00.000Z",
  "editedAt": null,
  "commentCount": 3,
  "likeCount": 5,
  "likedByMe": true,
  "myReaction": "LOVE",
  "reactions": { "LOVE": 3, "LIKE": 2 },
  "recentReactors": [{ "id": "...", "name": "Opa Jan", "avatarUrl": null }],
  "favoritedByMe": false
}
```

`type` is `UPDATE` or `MILESTONE` (milestones carry a short `milestoneTag` like `"Emma turns 5!"`). `uploadedAssetUrls` entries are either `/uploads/...` paths or `/api/immich/assets/...` proxy paths — both are served by the same server and need auth to fetch (see [media tokens](#media-tokens-reading-photos-and-videos)). `reactions` maps each used [reaction type](#reactions) to its count.

### Endpoints

| Method & path | Description |
| --- | --- |
| `GET /api/posts` | Your feed, newest first, paginated. Filters: `?groupIds=a,b` (comma-separated subset of your groups), `?groupId=x` (one group), or no filter = all your groups. Requesting a group you're not in is a `403`. |
| `GET /api/posts/search?groupId=&q=` | Case-insensitive search over `content` and `milestoneTag` within one group. Paginated. |
| `GET /api/posts/on-this-day?groupId=` | Posts created on today's month/day in a prior year. Not paginated (`{ items }` only). |
| `GET /api/posts/:id` | One post. |
| `POST /api/posts` | Create. Body: `{ groupId, content?, type?, milestoneTag?, uploadedAssetUrls?, latitude?, longitude?, locationName? }`. `uploadedAssetUrls` must be paths from the [upload endpoint](#uploads--media) or the Immich proxy for an album linked to *this* group — arbitrary URLs are rejected. `latitude`/`longitude` must be given together. |
| `PATCH /api/posts/:id` | Edit your own post (`content`, `milestoneTag`, location fields; pass `null` to clear location). Sets `editedAt`. |
| `DELETE /api/posts/:id` | Permanently delete your own post (admins can delete any). Cascades to its comments, reactions, and favorites. **There is no undo.** |

```bash
# Latest 5 posts across all your groups
curl -H "Authorization: Bearer $FAMLIN_TOKEN" "$FAMLIN_URL/api/posts?take=5"

# Post a milestone
curl -X POST "$FAMLIN_URL/api/posts" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groupId": "cmb1ghi...", "type": "MILESTONE", "milestoneTag": "First steps!", "content": "She walked across the whole living room 🎉"}'
```

## Comments

Comments live on a post; replies are one level deep via `parentId`. A comment can be pinned to a single photo/video of the post via `assetUrl` (one of the post's `uploadedAssetUrls`) instead of the post as a whole — replies inherit the parent's pin.

| Method & path | Description |
| --- | --- |
| `GET /api/posts/:postId/comments` | All comments on a post, oldest first. `?assetUrl=` filters to comments pinned to that photo/video. |
| `POST /api/posts/:postId/comments` | Create. Body: `{ content, parentId?, assetUrl?, mentionedUserIds? }` (content ≤ 2000 chars). `mentionedUserIds` are ids you resolved from the group member list for `@name` mentions — the server re-validates each is a current group member before notifying them. |
| `PATCH /api/comments/:id` | Edit your own comment: `{ content }`. Sets `editedAt`. |
| `DELETE /api/comments/:id` | Permanently delete your own comment (admins can delete any). |

Comment objects carry `author`, `likeCount`, `likedByMe`, `myReaction`, and a `reactions` count map, like posts do.

## Reactions

One reaction per user per post/comment. Types: `LIKE`, `LOVE`, `HAHA`, `WOW`, `SAD`, `CARE`.

| Method & path | Description |
| --- | --- |
| `POST /api/posts/:postId/like` | React to a post. Body: `{ type }` (optional, default `LIKE`). Sending your current reaction again **removes** it; a different one **switches**. Returns `{ myReaction, counts }`. |
| `POST /api/comments/:commentId/like` | Same, for a comment. |

## Favorites

Personal bookmarks, visible only to you.

| Method & path | Description |
| --- | --- |
| `POST /api/posts/:postId/favorite` | Toggle. Returns `{ favorited: true }` or `{ favorited: false }`. |
| `GET /api/favorites` | Your favorited posts across all your groups, newest-favorited first. Paginated; items are full [post objects](#the-post-object). |

## Notifications

Your in-app notification history (new posts, comments, reactions, mentions, "on this day" memories).

| Method & path | Description |
| --- | --- |
| `GET /api/notifications` | Latest 100 notifications: `[{ id, type, message, relatedPostId, post, readAt, createdAt }]`. |
| `GET /api/notifications/unread-count` | `{ count }`. |
| `PATCH /api/notifications/:id` | Body `{ read: boolean }` — set/clear `readAt`. |
| `POST /api/notifications/mark-all-read` | Mark everything read. |

## Uploads & media

| Method & path | Description |
| --- | --- |
| `POST /api/uploads` | `multipart/form-data`, one or more `file` parts. Allowed: jpg, jpeg, png, gif, webp, heic, heif, mp4, mov, m4v, webm; max 200 MB per file, 10 files per request; 60 uploads per 10 min. Returns `{ urls: ["/uploads/<uuid>.jpg", ...] }` — pass these into `POST /api/posts`. |
| `GET /api/uploads/media-token` | Issues a 7-day, read-only [media token](#media-tokens-reading-photos-and-videos) for fetching `/uploads/*` and Immich proxy URLs via `?token=`. |
| `GET /uploads/<file>` | The file itself. Requires an `Authorization` header **or** `?token=<media token>`. |

```bash
# Upload a photo, then post it
URLS=$(curl -s -X POST "$FAMLIN_URL/api/uploads" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -F "file=@beach.jpg" | jq -r '.urls[0]')

curl -X POST "$FAMLIN_URL/api/posts" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"groupId\": \"cmb1ghi...\", \"content\": \"Beach day ☀️\", \"uploadedAssetUrls\": [\"$URLS\"]}"
```

## Immich

When the admin has connected an [Immich](https://immich.app) server and linked albums to your groups, you can browse those albums and reference their photos in posts. All asset URLs are proxied through Famlin — your script never talks to Immich directly.

| Method & path | Description |
| --- | --- |
| `GET /api/immich/groups/:groupId/albums` | Albums linked to a group you're in: `[{ linkId, albumName, assetCount, ... }]`. |
| `GET /api/immich/albums/:linkId/assets` | The album's assets with ready-to-use proxy URLs (`thumbnailUrl`, `previewUrl`, `originalUrl`) and a `type` of `IMAGE` or `VIDEO`. |
| `GET /api/immich/assets/:linkId/:assetId/:variantExt` | Streams a rendition (`thumbnail.jpg`, `preview.jpg`, `original.jpg` or `original.mp4`). Auth like `/uploads/*`: header or `?token=`. Supports `Range` requests for video. |

## Push tokens

Only relevant if you're building an actual client app with Expo push notifications: `POST /api/push-tokens` (`{ token }`) registers a device token for the authenticated user, `DELETE /api/push-tokens?token=` unregisters it.

## Invites

Public (unauthenticated) endpoints used by invite links — useful if you're automating onboarding: `GET /api/invites/:token` previews an invite, `POST /api/invites/:token/register` creates an account from one, and `POST /api/invites/:token/accept` (authenticated) joins the invite's group with an existing account. Invites are created by admins in the admin UI.

## Recipe: a photo-frame script

Fetch the newest photo across your groups and download it — the skeleton of a digital photo frame:

```bash
#!/bin/sh
FAMLIN_URL="https://famlin.example.com"
FAMLIN_TOKEN="famlin_pat_..."

# 1. Newest post that has a photo
ASSET=$(curl -s -H "Authorization: Bearer $FAMLIN_TOKEN" \
  "$FAMLIN_URL/api/posts?take=30" \
  | jq -r '[.items[] | select(.uploadedAssetUrls | length > 0)][0].uploadedAssetUrls[0]')

# 2. Download it (works for /uploads/* and Immich proxy paths alike)
curl -s -H "Authorization: Bearer $FAMLIN_TOKEN" -o latest.jpg "$FAMLIN_URL$ASSET"
```

## Using the TypeScript client

The repo's [`packages/api-client`](https://github.com/TimVanOnckelen/famlin/tree/main/packages/api-client) (`@famlin/api-client`) is the typed axios layer the official web and mobile apps use — auth, posts, comments, uploads, react-query cache helpers, and the `fetchApiTokens`/`createApiToken`/`revokeApiToken` functions behind the token UI. It isn't published to npm, but if you're building in TypeScript you can depend on it from a checkout (`file:` dependency) and get the full typed surface instead of hand-rolling requests.
