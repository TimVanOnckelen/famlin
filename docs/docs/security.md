---
sidebar_position: 7
---

# Security policy

## Supported versions

Only the latest commit on the `main` branch is actively supported with security updates. Because Famlin is currently pre-1.0, we do not maintain separate release branches.

## Reporting a vulnerability

If you discover a security vulnerability in Famlin, please report it privately rather than opening a public issue.

Send details to the project maintainers. Include:

- A description of the vulnerability
- Steps to reproduce it
- Possible impact
- Suggested mitigation or fix if you have one

We will acknowledge receipt as soon as possible and work with you to address the issue responsibly.

## Security practices

- There is no default or seeded admin account. A fresh install has no users at all; the admin UI shows a one-time setup screen to create the first account (which becomes the first admin) the moment you first open `/admin` — that endpoint (`POST /api/auth/setup`) refuses to run again once any account exists. Don't rely on `prisma/seed.ts` (a dev/test-only fixture script with a hardcoded password) for a real deployment.
- Keep your `JWT_SECRET` and `POSTGRES_PASSWORD` long, random, and private.
- Run Famlin behind a reverse proxy with HTTPS in production, and set `TRUST_PROXY=true` once you do (see [Server setup](./server-setup#4-put-a-reverse-proxy-in-front)).
- Keep Docker images, dependencies, and the host OS up to date.
- Restrict admin access (`isAdmin = true`) to trusted users only. Famlin refuses to let the last remaining admin be demoted or removed, so you can't accidentally lock yourself out — but a compromised admin account is still a compromised app, so treat it accordingly.
- Invite links (generated from the admin UI's Groups page) are single-use and bypass the `allowedEmails` allow-list by design — treat a generated link like a password and only share it with the intended recipient. Set an expiry and/or restrict it to a specific email address when possible, and revoke unused links you no longer need.
- A password change/reset immediately invalidates any other session already logged into that account, and removing/deactivating a user does the same — you don't need to worry about a stolen or shared token outliving either action.
- Removing a user from the admin UI deactivates the account rather than deleting it — their existing posts, photos, and comments stay visible to the rest of the family, matching how removing someone from just one group already works. An admin can reactivate a deactivated account from the same page.
- Uploaded photos/videos aren't served as plain public files: the app fetches them using either your normal session or a separate, narrower media token, both of which expire — a leaked `/uploads/...` link on its own isn't enough to view family photos once that token has expired.
- Login and invite-registration endpoints are rate-limited to slow down credential-stuffing/brute-force attempts; this is automatic and needs no configuration.
