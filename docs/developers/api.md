---
sidebar_position: 3
---

# Using the API

Every Famlin server exposes a REST API under `/api` — the same API the mobile and web apps use. With a **personal access token** you can build your own integrations on top of your family's server: a digital photo frame that shows the latest posts, a script that posts a daily photo, a home-dashboard widget with unread notifications, and so on.

This page covers authentication and the conventions shared by every endpoint. The endpoints themselves are documented per-operation — with schemas, examples, and a try-it-out panel — in the **[API reference](./api-reference/famlin-api)**.

The base URL is your own deployment, e.g. `https://famlin.example.com`. The examples below assume:

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
- Tokens are **revocable at any time** from the same web UI (or [`DELETE /api/api-tokens/:id`](./api-reference/revoke-api-token)); revocation takes effect immediately.
- An optional expiry (set at creation) makes the token stop working after that date.
- Changing your password does **not** invalidate personal access tokens — it signs out app sessions but deliberately keeps integrations running. Revoke tokens explicitly.
- A request authenticated with a token **cannot create new tokens** (`403`) — a leaked token can't mint replacements for itself and outlive revocation. Token creation always requires an interactive login session.
- Token management is web-only by design; the mobile app has no token screen.

### Session tokens

Alternatively, [`POST /api/auth/login`](./api-reference/login) with your email and password returns a JWT valid for 30 days — this is what the apps themselves use. It's fine for quick experiments, but for anything long-lived prefer a personal access token: session tokens expire, and all of them are invalidated whenever you change your password.

```bash
curl -X POST "$FAMLIN_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "..."}'
# → { "token": "eyJ...", "user": { ... } }
```

Both token kinds are sent the same way (`Authorization: Bearer <token>`), and every endpoint works identically with either.

### Media tokens (reading photos and videos)

Files under `/uploads/*` and the Immich proxy under `/api/immich/assets/*` are auth-gated. You can read them with your normal `Authorization` header (personal access tokens work), but for contexts that can't send headers — an `<img>` tag, a video player — request a narrow-scope **media token** via [`GET /api/uploads/media-token`](./api-reference/get-media-token) and append it as a query parameter:

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

**Rate limits:** 300 requests/minute per IP overall; `POST /api/uploads` is additionally limited to 60 uploads per 10 minutes, and login endpoints to 10 attempts per 15 minutes. `429` responses include standard `retry-after` headers.

**Pagination:** list endpoints that can grow large ([`GET /api/posts`](./api-reference/list-posts), [`/api/posts/search`](./api-reference/search-posts), [`/api/favorites`](./api-reference/list-favorites)) take `?cursor=` and `?take=` (default 30, max 100) and return:

```json
{ "items": [ ... ], "nextCursor": "cmb1..." }
```

Pass `nextCursor` back as `?cursor=` for the next page; `null` means you've reached the end.

**Authorization model:** every piece of content belongs to exactly one group (family), and you can only see or touch content in groups you are a member of. There is no way to opt out of this per token — a request for a group you're not in is a `403`. Admin-only management endpoints live under `/api/admin` and require an admin account; they're not part of the documented API (see [Architecture](./architecture) for the full route map).

## Recipe: post a photo update

Upload first, then reference the returned path in the post:

```bash
URLS=$(curl -s -X POST "$FAMLIN_URL/api/uploads" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -F "file=@beach.jpg" | jq -r '.urls[0]')

curl -X POST "$FAMLIN_URL/api/posts" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"groupId\": \"cmb1ghi...\", \"content\": \"Beach day ☀️\", \"uploadedAssetUrls\": [\"$URLS\"]}"
```

## Recipe: create a poll and vote on it

`type: "POLL"` creates a poll instead of a plain update: `content` is the question, and `typeData.options` is 2-10 choices (each 1-100 characters). Voting is a separate call to [`POST /api/posts/{postId}/interactions`](./api-reference/interact-with-post) with `key: "vote"`:

```bash
POST_ID=$(curl -s -X POST "$FAMLIN_URL/api/posts" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groupId": "cmb1ghi...", "type": "POLL", "content": "Pizza or tacos tonight?", "typeData": {"options": [{"text": "Pizza"}, {"text": "Tacos"}]}}' \
  | jq -r '.id')

# Grab an option id from typeData.options (assigned by the server at creation)
OPTION_ID=$(curl -s -H "Authorization: Bearer $FAMLIN_TOKEN" "$FAMLIN_URL/api/posts/$POST_ID" \
  | jq -r '.typeData.options[0].id')

# Vote — the response is the full post, with the live tally in `poll`
curl -X POST "$FAMLIN_URL/api/posts/$POST_ID/interactions" \
  -H "Authorization: Bearer $FAMLIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"vote\", \"value\": {\"optionId\": \"$OPTION_ID\"}}"
```

Sending the same `{"key": "vote", "value": {"optionId": "..."}}` again **removes** your vote; sending a different `optionId` **switches** it — the same toggle-or-switch behavior as reactions. Votes are public to group members (not anonymous), and everyone can see the tally whether or not they've voted yet.

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

## Keeping the reference up to date

The [API reference](./api-reference/famlin-api) is generated from [`docs/openapi/famlin.yaml`](https://github.com/TimVanOnckelen/famlin/blob/main/docs/openapi/famlin.yaml) by [docusaurus-plugin-openapi-docs](https://github.com/PaloAltoNetworks/docusaurus-openapi-docs). After editing the spec, run `npm run gen-api-docs` in `docs/` (the build does this automatically).
