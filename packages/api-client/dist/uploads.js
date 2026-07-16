"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadUrl = getUploadUrl;
exports.refreshMediaToken = refreshMediaToken;
exports.ensureFreshMediaToken = ensureFreshMediaToken;
const client_1 = require("./client");
// Extensions the backend may have generated a `-thumbnail.jpg` sibling for
// (see backend/src/services/uploadVariants.ts) — .gif and video extensions
// never get one. Uploads made before that feature shipped also won't have
// one even if their extension is in this set; callers should fall back to
// the plain (non-variant) URL on a load error for that case.
const THUMBNAIL_ELIGIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
function toThumbnailPath(path) {
    const dotIndex = path.lastIndexOf('.');
    const ext = dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : '';
    if (!THUMBNAIL_ELIGIBLE_EXTENSIONS.has(ext))
        return path;
    return `${path.slice(0, dotIndex)}-thumbnail.jpg`;
}
// Uploaded photos/videos require a media token (see backend app.ts's
// /uploads onRequest hook) — append the cached one as a query param so
// <Image>/<Video> sources, which can't attach custom headers, can still
// authenticate the GET. Pass variant: 'thumbnail' for small grid/list tiles;
// leave it unset everywhere else — the plain path already serves a
// backend-compressed display copy for new uploads (see uploadVariants.ts).
function getUploadUrl(path, variant) {
    const resolvedPath = variant === 'thumbnail' ? toThumbnailPath(path) : path;
    const serverUrl = (0, client_1.getCurrentServerUrl)();
    // No server URL yet (pre-init) — return the raw path rather than a
    // "nullundefined"-style string; the caller has nothing usable to load yet.
    if (!serverUrl)
        return resolvedPath;
    const token = (0, client_1.getCurrentMediaToken)();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${serverUrl}${resolvedPath}${query}`;
}
let mediaTokenFetchedAt = null;
const MEDIA_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
async function refreshMediaToken() {
    // The media token TTL (7d) is shorter than the session token TTL (30d), and
    // <Image>/<Video> requests bypass axios entirely (no 401 handler), so a
    // dropped request here has no other retry path — try a second time before
    // giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await client_1.api.get('/uploads/media-token');
            (0, client_1.setMediaToken)(response.data.token);
            mediaTokenFetchedAt = Date.now();
            return;
        }
        catch {
            if (attempt === 1) {
                (0, client_1.setMediaToken)(null);
                mediaTokenFetchedAt = null;
            }
        }
    }
}
// Called when the app returns to the foreground while a user is signed in —
// re-fetches the media token if it's missing (e.g. a previous refresh failed)
// or has gone stale, since nothing else proactively refreshes it.
async function ensureFreshMediaToken() {
    const isStale = mediaTokenFetchedAt === null || Date.now() - mediaTokenFetchedAt > MEDIA_TOKEN_MAX_AGE_MS;
    if (!(0, client_1.getCurrentMediaToken)() || isStale) {
        await refreshMediaToken();
    }
}
