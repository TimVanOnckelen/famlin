---
sidebar_position: 7
---

# Security

Famlin keeps family content on your own server and checks access on the server, not just in the apps. This page explains the security model, the privacy boundaries, and the settings that matter when you self-host.

## Security checklist

For a typical installation:

- **Use HTTPS.** Put Famlin behind the bundled Caddy setup, a Cloudflare Tunnel, or your own reverse proxy. Set `TRUST_PROXY=true` only when a reverse proxy is actually in front of Famlin. See [Server setup](./server-setup.md#4-set-up-https).
- **Keep everything updated.** Update Famlin, Docker images, dependencies, and the host OS.
- **Limit administrator access.** Give admin rights only to trusted people. Famlin prevents removing or demoting the last admin, but a compromised admin account still compromises the app.
- **Protect your secrets.** Famlin generates the login and database secrets automatically. If you provide them yourself, use long, random, private values.
- **Treat invite links like passwords.** Share them only with the intended recipient, set an expiry or email restriction when possible, and revoke unused links.
- **Keep S3 buckets private.** Famlin performs media access checks; the bucket itself should never allow public reads.

## Supported versions

Only the latest commit on the `main` branch is actively supported with security updates. While Famlin is pre-1.0, separate release branches are not maintained.

## Reporting a vulnerability

Report security vulnerabilities privately to the project maintainers rather than opening a public issue. Include:

- A description of the vulnerability
- Steps to reproduce it
- The possible impact
- A suggested mitigation or fix, if you have one

The maintainers will acknowledge receipt as soon as possible and work with you to address the issue responsibly.

## Accounts and sign-in

### First account and automatic secrets

A fresh installation has **no default or seeded admin account**. Opening `/admin` shows a one-time setup screen for the first account, which becomes an administrator. Once any account exists, the setup endpoint refuses to run again. The seed script is a development and test fixture with hardcoded passwords—never use it for a real deployment.

Without a `.env`, Famlin generates:

- A random `JWT_SECRET`, stored with mode `0600` in the `famlin-data` volume
- A random database password, stored in the `famlin-db-secret` volume

If you set `JWT_SECRET` or `POSTGRES_PASSWORD` yourself, keep both long, random, and private.

### Restoring a backup on an unconfigured server

The first-run screen can restore a scheduled backup only while the server has zero accounts, under the same protection as initial setup. It reads a named dump already present in the backup volume's `db/` folder; it deliberately does **not** accept a dump upload. Restoring runs SQL with Famlin's database privileges, so requiring server access to place the file prevents someone who merely reaches an unconfigured server from running an arbitrary dump.

### Sessions and account removal

Changing or resetting a password immediately invalidates the account's existing sessions. Deactivating an account does the same, so a stolen session token doesn't outlive either action.

Removing a user in the admin UI **deactivates** rather than deletes the account. Their existing posts, photos, and comments remain visible to the family, just as they do when someone leaves one group. An admin can reactivate the account later.

### API tokens

Personal API tokens for scripts and integrations are deliberately **not** revoked by a password reset, so integrations keep running. They:

- Are stored only as a SHA-256 hash; the secret is shown once
- Can have an expiry date and can be revoked individually with immediate effect
- Have no more permissions than the account that created them
- Cannot be used to create more tokens
- Are deleted together with their user

Treat every token like a password. See [Using the API](/developers/api).

### SSO and Sign in with Apple

**SSO requires a verified email.** Famlin matches SSO accounts by email and rejects a login when the identity provider explicitly reports `email_verified: false`. Keep email verification enabled at providers that allow self-registration or user-editable email addresses.

**Apple sign-ins are bound to your server.** The iPhone app includes the server address in the sign-in nonce, and your server rejects a token created for another address. This prevents one Famlin server from replaying your Apple sign-in against another. Set the [public address](./admin-configuration.md) for the strongest check. While it is empty, Famlin uses the request's `Host` header, never the client-spoofable `X-Forwarded-Host`; a directly reachable server therefore trusts the requested host. Older app builds without nonce support are still accepted, so keep the app updated.

The mobile app sends your session only to the server you signed in to. An invite for another server shows its address and requires a separate sign-in; it never receives your existing session.

## Family privacy

### Families and circles

Family membership is the main access boundary. **Family Circles** narrow that audience further and are enforced on the server:

- Circle posts are excluded from feeds, search, memories, photo timelines, notifications, comments, reactions, and direct media requests for non-members.
- Outsiders receive a `404`, with no hidden placeholder, so they cannot distinguish a private post from one that doesn't exist.
- People outside a circle cannot discover its name, members, or existence.
- Removing someone from a family also removes them from every circle in it immediately, ending access to its posts and photos.

#### What administrators can see

Circle privacy applies to admins too. An admin outside a circle cannot read its content, including in moderation screens. They can add themselves to the circle, but every member can see the member list and when each person joined—nobody can enter and read silently.

Consequently, content in a circle the admin hasn't joined cannot be moderated directly. Deleting the whole circle is the only available admin action; it permanently deletes its posts after showing the count and asking for confirmation.

There are two deliberate boundaries to this protection:

- The **admin backup export** includes all family content, including every circle. Omitting private content would make the backup incomplete. A restore preserves the circles and their media access rules.
- Anyone with **direct database or filesystem access** can read everything. Circles separate family members; they don't protect content from the server operator.

### Photos and videos

Uploaded media is not served as public files. Each request uses either the member's session or a narrower, expiring media token, and Famlin checks the audience again:

- A post, comment, chat, or story attachment is available only to members of the families it was shared with. Someone from another family receives a `404`, even with the exact URL.
- Removing a member from a family also revokes access to its protected media.
- Profile pictures are visible to every signed-in user because they appear across that person's families.
- A media token unlocks media only; it cannot be used elsewhere in the API or to act as its owner.
- A photo's audience is fixed when its uploader first attaches it. Reusing the URL elsewhere, or reusing someone else's photo, cannot widen or narrow access.

Access rules apply to files attached **after** the release that introduced each rule. Older files remain reachable by any signed-in user who has their URL until a future backfill changes that behavior.

:::warning Linked albums have a wider audience
A photo uploaded to a circle post is circle-private, but a photo in a **linked Immich or local album** is already available to every member of that album's family through the album browser. Adding it to a circle post does not make it private. Upload the photo directly to the post when it must be circle-private.
:::

### Stories

An unhighlighted story stops being visible after 24 hours and is permanently deleted by a job running every 10 minutes. Deletion covers its database rows, served image, thumbnail, and original upload. Story photos must be fresh uploads owned by their author, so deletion cannot remove media used by another post.

Stories follow the same family and circle rules as posts, including direct media URLs. Only the author sees the viewer list. A private reply is readable only by its sender and the story's author; no API, admin screen, push log, or export exposes it to anyone else except someone with direct database access.

### Exports

**Admin exports** contain all family content. Their browser download links use a random token instead of the admin's session. The token works once, expires after 60 seconds, can only be created by a signed-in admin session—not an API token—and is checked against the account's current admin status when used.

**Member exports** contain what that member can already see in their families, including other members' posts and photos from shared groups. They exclude other families and circles, other people's favorites and settings, credentials, invites, and tokens. Members can start an export from their profile, rate-limited to five exports per user per hour.

A member export includes that member's own latest device diagnostics. Admin backups and restores exclude devices and push tokens; mobile apps report their current state again after a restore.

### Public branding

The family name and logo configured under **Server settings → Branding** are public to anyone who can reach the server because the login page displays them. Logos use the public `/branding/...` path, never protected `/uploads/...` URLs. Uploaded logos are re-encoded from pixels; SVG is rejected because it can contain script. Login backgrounds are color gradients rather than photos for the same reason.

## Network, storage, and diagnostics

### HTTPS and Cloudflare

Use a reverse proxy with HTTPS in production and set `TRUST_PROXY=true` only behind that proxy. The proxy must set the forwarded host and protocol headers correctly; see [Server setup](./server-setup.md#option-c-your-own-reverse-proxy).

With [Cloudflare Tunnel](./cloudflare-tunnel.md), Cloudflare terminates TLS and can technically read traffic between your family and the server, including posts, photos, and session tokens. The tunnel avoids open ports and reduces that part of your attack surface. If you don't want a third party in the traffic path, use Caddy or your own reverse proxy instead.

### S3-compatible storage

With [S3 storage](./storage.md#option-c-s3-or-an-s3-compatible-service), Famlin still serves photos through its own access checks. Keep the bucket private, restrict Famlin's key to that bucket when possible, and protect `S3_SECRET_ACCESS_KEY` like `JWT_SECRET`—in `.env`, never in the repository.

Deleted photos are removed from the bucket too. If bucket versioning is enabled, old versions remain until your lifecycle rules remove them.

### Mobile device diagnostics

The mobile app reports only a random install ID, platform, OS version, app version/build, and push permission to the Famlin server used by that account. It sends no device model, locale, IP address, activity data, timestamps, or last-seen field, and doesn't rewrite an unchanged report. Nothing is sent to the Famlin maintainer, Expo, or another third party.

Members can see these fields in their profile; admins see current device state on the Devices page. The web app reports no device diagnostics.

### Rate limits

Login, password change, password reset, and invite preview/registration endpoints are rate-limited automatically to slow credential-stuffing, brute-force, and token-guessing attempts.

Reading media through `GET` or `HEAD /uploads/*` is exempt so large galleries don't exhaust the shared API budget; authentication and media access checks still apply. Uploading through `POST /api/uploads` remains limited to 60 requests per 10 minutes per IP address.
