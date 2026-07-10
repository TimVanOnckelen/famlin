---
sidebar_position: 3
---

# Admin configuration

Once the containers from [Server setup](./server-setup) are up and reachable, finish setup from the admin UI at `/admin`.

## First login

Open `https://famlin.yourdomain.com/admin`. On a fresh install (no users in the database yet) it shows a **one-time setup screen** instead of the login form — fill in your name, email, and a password to create the first account, which is automatically made an admin. There is no default or seeded account; if the setup screen doesn't appear, an admin account already exists and you should log in with it instead (an existing admin can reset another admin's password from the Users page; if every admin's password and access is lost, the only recovery path is connecting to the `famlin-db` container directly and clearing the affected row).

From `/admin` → Server settings you can then configure everything below. The page is organised into four sections — **General**, **Sign-in & access**, **Notifications**, and **Media** — each showing a status indicator (configured / not set up) so you can see at a glance what still needs attention; changes across all sections are saved together with the save bar that appears at the bottom.

- **Default language** (General) — used for server-rendered pages that don't have a signed-in user yet, currently the invite link landing page (`/invite/:token`). Defaults to English.
- **App Store / Google Play URLs** (General) — optional. If set, the invite link page shows download buttons for people who don't have the app yet; leave blank to hide them. **Google Play** defaults to the official pre-built Android app (`https://play.google.com/store/apps/details?id=be.xeweb.famlin`) so a fresh deployment already has a working download link — override it if you build and distribute your own Android app instead. There's no equivalent default for **App Store**, since Apple has no single-listing distribution model; leave it blank unless you publish your own iOS build.
- **OIDC / SSO** (Sign-in & access) — see [OIDC / SSO login](#oidc--sso-login) below. Optional; email/password login always works.
- **Allowed email addresses** (Sign-in & access) — restrict which emails may create an account. Leave empty to allow anyone who reaches the login page.
- **SMTP** (Notifications) — host, port, username, password, and sender address for email notifications.
- **Push notifications** (Notifications) — enable/disable Expo push notifications globally.
- **Media integrations** (Media: Immich, local folders) — see [Media integrations](#media-integrations) below. Optional.

All of this is stored in the database, so it survives redeploys of the backend image without any env var changes.

## OIDC / SSO login

Famlin supports login via any standards-compliant OpenID Connect provider (Google, Microsoft Entra ID, Authentik, Keycloak, Auth0, ...) alongside email/password, configured entirely from `/admin` — no rebuild or client-side env vars required.

Setup differs slightly depending on whether your provider supports a secretless public/native client:

### Self-hosted providers (Authentik, Keycloak, Auth0, ...)

1. Register Famlin as a **public/native client** (no client secret), with **PKCE** enabled.
2. Add redirect URIs:
   - Mobile app: `famlin://` (the app's URL scheme; see `mobile/app.config.js`)
   - Web app: `https://famlin.yourdomain.com/`
   - Admin UI: `https://famlin.yourdomain.com/admin/`
3. In `/admin` → Server settings, fill in **Issuer URL**, **Client ID**, **Scopes** (defaults to `openid email profile`), and **Display name** (shown on the login button). Leave **Client secret** blank.

### Google

Google's OAuth clients always require a client secret for the token exchange, and its native "iOS"/"Android" client types force the mobile redirect onto a Google-generated scheme Famlin's shared, pre-built Android app can't have baked in ahead of time (every self-hosted deployment registers its own separate Google client). So instead, register one ordinary **Web application** client:

1. In [Google Cloud Console](https://console.cloud.google.com/auth/clients) → **Create OAuth client** → **Web application**.
2. Add three **Authorized redirect URIs**:
   - `https://famlin.yourdomain.com/` (web app)
   - `https://famlin.yourdomain.com/admin/` (admin UI)
   - `https://famlin.yourdomain.com/api/auth/oidc/mobile-callback` (mobile app)
3. Copy the **Client ID** and **Client secret** Google generates.
4. In `/admin` → Server settings, fill in:
   - **Issuer URL**: `https://accounts.google.com`
   - **Client ID** and **Client secret** (Google is the main reason this field exists — most other providers don't need it)
   - **Scopes**: `openid email profile`
   - **Display name**: e.g. `Google`

Setting a **Client secret** makes Famlin do the authorization code exchange on the backend instead of in the browser/app, which is what lets a normal Web application client work for the web app, the admin UI, and the mobile app — see [Architecture: OIDC / client-secret providers](/docs/developers/architecture#oidc--client-secret-providers) for how that works under the hood.

### Access control

Optionally restrict sign-ups with **Allowed email addresses** (`/admin` → Server settings). New accounts are only auto-provisioned via OIDC if the email is allowed (empty allow-list = allow all). An unlisted email will be rejected even with a valid OIDC login.

## Media integrations

Famlin can let members pick photos from external sources when composing a post, without copying anything into Famlin's own storage. Each source is configured once for the whole server (`/admin` → Server settings → **Media**); which albums are visible to which group is then linked per group (`/admin` → Groups → **Linked albums**). A group can have multiple linked albums across different sources.

### Immich

If your family already runs [Immich](https://immich.app) for photo storage:

**Recommended setup:** Create a dedicated Famlin user in Immich, then have family members share their albums with that user. This way, Famlin can list all relevant albums in one place without you manually linking each one.

1. In Immich (as an admin), create a user account for Famlin (e.g. `famlin@home.local`).
2. Have each family member share their albums with this Famlin user (in Immich, right-click an album → Share → add the Famlin user).
3. Create an API key for the Famlin account (log in as the Famlin user, Account settings → API Keys). A key scoped to just `album.read`, `asset.read`, `asset.view`, and `asset.download` is enough — Famlin never writes to Immich.
4. In `/admin` → Server settings → **Media** → **Immich**, enter your Immich server URL (e.g. `https://immich.example.com`) and the API key, then click **Test connection** to confirm Famlin can reach it.
5. Save settings.
6. Go to `/admin` → Groups, select a group, and under **Linked albums** → **Immich** the dropdown now shows both the Famlin account's own albums and any shared with it. Pick the ones you want this group to see.

Members never see an Immich login, token, or API key — the underlying image is streamed live from your Immich server through Famlin's own authenticated proxy.

### Local folders

Serve photos straight from a directory on the server — handy when your photos already live on the NAS Famlin runs on and are synced there by another tool (Syncthing, rsync, a phone upload app).

1. Make the directory visible inside the Famlin container: add a bind mount to the `famlin-backend` service in your `docker-compose.yml`, e.g. `- /volume1/photos/famlin:/media/photos:ro` (read-only is enough — Famlin never writes to it).
2. In `/admin` → Server settings → **Media** → **Local folders**, enter the *container-side* path (e.g. `/media/photos`) and click **Check path**.
3. Save settings.
4. Every immediate subdirectory of that path is now a linkable album: go to `/admin` → Groups, select a group, and under **Linked albums** choose **Local folders** as the media source and pick a folder.

Only image files (`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`) directly inside the folder are listed — subfolders of an album and video files are ignored for now. Thumbnails are generated on the fly and cached inside the container.

### New asset detection

Each linked album can be configured to surface newly-added assets to your family automatically:

- **OFF** (default) — never notify about new assets. The album appears in Famlin but doesn't send alerts or create posts.
- **MANUAL** — send a notification when new assets appear. Members get a notification (as if a new post arrived) but Famlin doesn't auto-create a post — good for albums you want to stay aware of without flooding the feed.
- **AUTO** — automatically create a post in the group with new assets. An hourly job checks linked albums; when it finds new photos/videos, it creates a real post (authored by an admin, preferring a group-member admin if one exists) that flows through Famlin's normal post pipeline with notifications — good for auto-import workflows (e.g., a Synology camera folder that fills hourly, a cloud-synced photo album).

To set this, go to `/admin` → Groups → **Linked albums**, click an album, and choose a mode.

The hourly job runs at minute 15 of every hour (check the server logs to confirm it's running). On the first run for an album, it only initializes the watermark — it doesn't retroactively notify about pre-existing assets, only new ones added after that point.

### Mapping people in albums

For Immich albums with face recognition data, you can map recognized people to display names and optionally link them to Famlin users. This lets members filter album views by person when composing a post (e.g., "show me photos of Alice") and keeps face data private — only admin-mapped people are visible to family.

1. Go to `/admin` → Server settings → **Media** → **Immich** — the **People mapping** section sits inside the Immich card, since the recognized people come from Immich's face recognition.
2. Under **Unmapped people**, search or browse the grid of recognized faces and click a person.
3. Fill in the **Display name** (a human-readable name shown to family, e.g. "Alice" or "Grandpa") and optionally a **Family member** (pick a Famlin user if this person is someone in the family; leave blank otherwise), then click **Save**. Mapped people now appear in member UI when they're picking photos for a post, scoped to each group's linked albums.

Mapped people also appear as tags on posts in the family feed, showing who's in each photo — when a person is linked to a Famlin user, their profile avatar appears on the tag.

To remove a mapping, click the × next to it under **Mapped people**.

## Next steps

Once your admin account and login method are set up, [invite family members](./inviting-family) to start using Famlin.
