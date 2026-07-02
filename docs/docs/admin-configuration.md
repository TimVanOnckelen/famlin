---
sidebar_position: 3
---

# Admin configuration

Once the containers from [Server setup](./server-setup) are up and reachable, finish setup from the admin UI at `/admin`.

## First login

Open `https://famlin.yourdomain.com/admin`. On a fresh install (no users in the database yet) it shows a **one-time setup screen** instead of the login form — fill in your name, email, and a password to create the first account, which is automatically made an admin. There is no default or seeded account; if the setup screen doesn't appear, an admin account already exists and you should log in with it instead (an existing admin can reset another admin's password from the Users page; if every admin's password and access is lost, the only recovery path is connecting to the `famlin-db` container directly and clearing the affected row).

From `/admin` → Server settings you can then configure:

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
