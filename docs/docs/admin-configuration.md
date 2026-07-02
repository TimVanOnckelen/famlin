---
sidebar_position: 3
---

# Admin configuration

Once the containers from [Server setup](./server-setup) are up and reachable, finish setup from the admin UI at `/admin`.

## First login

Log in at `https://famlin.yourdomain.com/admin` with the seed admin account:

- **Email:** `admin@example.com`
- **Password:** `test123456`

**Change this password immediately** (or replace the account) — it's a well-known default. From `/admin` → Server settings you can then configure:

- **Default language** — used for server-rendered pages that don't have a signed-in user yet, currently the invite link landing page (`/invite/:token`). Defaults to English.
- **App Store / Google Play URLs** — optional. If set, the invite link page shows download buttons for people who don't have the app yet; leave blank to hide them.
- **OIDC / SSO** — see [OIDC / SSO login](#oidc--sso-login) below. Optional; email/password login always works.
- **Allowed email addresses** — restrict which emails may create an account. Leave empty to allow anyone who reaches the login page.
- **SMTP** — host, port, username, password, and sender address for email notifications.
- **Push notifications** — enable/disable Expo push notifications globally.

All of this is stored in the database, so it survives redeploys of the backend image without any env var changes.

## OIDC / SSO login

Famlin supports login via any standards-compliant OpenID Connect provider (Google, Microsoft Entra ID, Authentik, Keycloak, Auth0, ...) alongside email/password, configured entirely from `/admin` — no rebuild or client-side env vars required.

1. In your identity provider, register Famlin as a **public/native client** (no client secret), with **PKCE** enabled.
2. Add redirect URIs:
   - Mobile app: `famlin://` (the app's URL scheme; see `mobile/app.config.js`)
   - Admin UI: `https://famlin.yourdomain.com/admin/`
3. In `/admin` → Server settings, fill in:
   - **Issuer URL** — e.g. `https://accounts.google.com` or `https://auth.example.com/application/o/famlin/`
   - **Client ID**
   - **Scopes** — defaults to `openid email profile`
   - **Display name** — shown on the login button (e.g. "Google", "Authentik")
4. Optionally restrict sign-ups with **Allowed email addresses**.

New accounts are only auto-provisioned via OIDC if the email is allowed (empty allow-list = allow all). An unlisted email will be rejected even with a valid OIDC login.

## Next steps

Once your admin account and login method are set up, [invite family members](./inviting-family) to start using Famlin.
