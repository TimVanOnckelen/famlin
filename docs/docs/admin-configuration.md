---
sidebar_position: 3
---

# Admin configuration

Once the containers from [Server setup](./server-setup) are up and reachable, finish setup from the admin UI at `/admin`.

## First login

Open `https://famlin.yourdomain.com/admin`. On a fresh install (no users in the database yet) it shows a **one-time setup screen** instead of the login form — fill in your name, email, and a password to create the first account, which is automatically made an admin. There is no default or seeded account; if the setup screen doesn't appear, an admin account already exists and you should log in with it instead (an existing admin can reset another admin's password from the Users page; if every admin's password and access is lost, the only recovery path is connecting to the `famlin-db` container directly and clearing the affected row).

From `/admin` → Server settings you can then configure:

- **Default language** — used for server-rendered pages that don't have a signed-in user yet, currently the invite link landing page (`/invite/:token`). Defaults to English.
- **App Store / Google Play URLs** — optional. If set, the invite link page shows download buttons for people who don't have the app yet; leave blank to hide them. **Google Play** defaults to the official pre-built Android app (`https://play.google.com/store/apps/details?id=be.xeweb.famlin`) so a fresh deployment already has a working download link — override it if you build and distribute your own Android app instead. There's no equivalent default for **App Store**, since Apple has no single-listing distribution model; leave it blank unless you publish your own iOS build.
- **OIDC / SSO** — see [OIDC / SSO login](#oidc--sso-login) below. Optional; email/password login always works.
- **Allowed email addresses** — restrict which emails may create an account. Leave empty to allow anyone who reaches the login page.
- **SMTP** — host, port, username, password, and sender address for email notifications.
- **Push notifications** — enable/disable Expo push notifications globally.
- **Immich** — see [Immich integration](#immich-integration) below. Optional.

All of this is stored in the database, so it survives redeploys of the backend image without any env var changes.

## OIDC / SSO login

Famlin supports login via any standards-compliant OpenID Connect provider (Google, Microsoft Entra ID, Authentik, Keycloak, Auth0, ...) alongside email/password, configured entirely from `/admin` — no rebuild or client-side env vars required.

Setup differs slightly depending on whether your provider supports a secretless public/native client:

### Self-hosted providers (Authentik, Keycloak, Auth0, ...)

1. Register Famlin as a **public/native client** (no client secret), with **PKCE** enabled.
2. Add redirect URIs:
   - Mobile app: `famlin://` (the app's URL scheme; see `mobile/app.config.js`)
   - Admin UI: `https://famlin.yourdomain.com/admin/`
3. In `/admin` → Server settings, fill in **Issuer URL**, **Client ID**, **Scopes** (defaults to `openid email profile`), and **Display name** (shown on the login button). Leave **Client secret** blank.

### Google

Google's OAuth clients always require a client secret for the token exchange, and its native "iOS"/"Android" client types force the mobile redirect onto a Google-generated scheme Famlin's shared, pre-built Android app can't have baked in ahead of time (every self-hosted deployment registers its own separate Google client). So instead, register one ordinary **Web application** client:

1. In [Google Cloud Console](https://console.cloud.google.com/auth/clients) → **Create OAuth client** → **Web application**.
2. Add two **Authorized redirect URIs**:
   - `https://famlin.yourdomain.com/admin/`
   - `https://famlin.yourdomain.com/api/auth/oidc/mobile-callback`
3. Copy the **Client ID** and **Client secret** Google generates.
4. In `/admin` → Server settings, fill in:
   - **Issuer URL**: `https://accounts.google.com`
   - **Client ID** and **Client secret** (Google is the main reason this field exists — most other providers don't need it)
   - **Scopes**: `openid email profile`
   - **Display name**: e.g. `Google`

Setting a **Client secret** makes Famlin do the authorization code exchange on the backend instead of in the browser/app, which is what lets a normal Web application client work for both the admin UI and the mobile app — see [Architecture: OIDC / client-secret providers](/docs/developers/architecture#oidc--client-secret-providers) for how that works under the hood.

### Access control

Optionally restrict sign-ups with **Allowed email addresses** (`/admin` → Server settings). New accounts are only auto-provisioned via OIDC if the email is allowed (empty allow-list = allow all). An unlisted email will be rejected even with a valid OIDC login.

## Immich integration

If your family already runs [Immich](https://immich.app) for photo storage, you can let members pick photos from specific Immich albums when composing a Famlin post — without anyone creating their own Immich login or API key.

1. In Immich, create an API key (Account settings → API Keys). A key scoped to just `album.read`, `asset.read`, `asset.view`, and `asset.download` is enough — Famlin never writes to Immich.
2. In `/admin` → Server settings → **Immich**, enter your Immich server URL (e.g. `https://immich.example.com`) and the API key, then click **Test connection** to confirm Famlin can reach it.
3. Save settings.
4. Go to `/admin` → Groups, select a group, and under **Immich albums** pick an album from the dropdown to link it to that group. A group can have multiple linked albums; an album can only be linked to one group at a time.

Once linked, members of that group see a "Choose from Immich" option alongside the usual photo picker when creating a post. Picked photos are attached exactly like an uploaded photo — they appear in the feed and support comments and reactions the same way — but the underlying image is streamed live from your Immich server rather than copied into Famlin's own storage.

## Next steps

Once your admin account and login method are set up, [invite family members](./inviting-family) to start using Famlin.
