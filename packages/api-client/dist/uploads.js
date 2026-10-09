"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_TIMEOUT_MS = void 0;
exports.getUploadUrl = getUploadUrl;
exports.uploadFiles = uploadFiles;
exports.uploadFilesInSession = uploadFilesInSession;
exports.refreshMediaToken = refreshMediaToken;
exports.ensureFreshMediaToken = ensureFreshMediaToken;
exports.uploadKey = uploadKey;
exports.fetchUploadProcessing = fetchUploadProcessing;
const client_1 = require("./client");
// Extensions the backend may have generated a `-thumbnail.jpg` sibling for
// (see backend/src/services/uploadVariants.ts) — .gif and video extensions
// never get one. Uploads made before that feature shipped also won't have
// one even if their extension is in this set; callers should fall back to
// the plain (non-variant) URL on a load error for that case.
const THUMBNAIL_ELIGIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov', '.m4v', '.webm']);
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
// Uploading is the one request that routinely outlives the client's default
// 15s timeout (see client.ts) — a phone photo, let alone a video, can take
// minutes on mobile data, and an aborted upload surfaces to the user as an
// opaque "Network Error". Every upload call site must pass this.
exports.UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
async function sendUpload(files, onProgress, sessionId, excludedKeys = []) {
    const formData = new FormData();
    // The upload route walks every file part in the request, so one round trip
    // covers the whole batch (same as mobile's uploadMedia).
    for (const file of files) {
        formData.append('file', file);
    }
    const response = await client_1.api.post('/uploads', formData, {
        headers: { 'Content-Type': undefined, ...(sessionId ? { 'X-Upload-Session-Id': sessionId } : {}), ...(excludedKeys.length ? { 'X-Upload-Session-Exclude': JSON.stringify(excludedKeys) } : {}) },
        timeout: exports.UPLOAD_TIMEOUT_MS,
        onUploadProgress: onProgress
            ? (event) => {
                if (event.total)
                    onProgress(Math.min(1, event.loaded / event.total));
            }
            : undefined,
    });
    return response.data;
}
async function uploadFiles(files, onProgress) {
    return (await sendUpload(files, onProgress)).urls;
}
async function uploadFilesInSession(files, sessionId, excludedKeys = []) {
    return sendUpload(files, undefined, sessionId, excludedKeys);
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
                // Deliberately keep whatever token is already cached: it's valid for
                // 7d and a transient refresh failure (offline, flaky connection) is
                // no reason to throw it away — dropping it turns every subsequent
                // <Image>/<Video> GET into a 401 with no retry path. Only the
                // freshness stamp is cleared, so ensureFreshMediaToken() retries on
                // the next foreground.
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
function uploadKey(url) {
    return url.match(/\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-thumbnail)?\.[a-z0-9]+(?:\?|$)/i)?.[1] ?? null;
}
async function fetchUploadProcessing(assetKey) {
    const response = await client_1.api.get(`/uploads/status/${assetKey}`);
    return response.data;
}
