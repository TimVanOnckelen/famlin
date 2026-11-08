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
const features_1 = require("./features");
// Extensions the backend may have generated a `-thumbnail.jpg` sibling for
// (see backend/src/services/uploadVariants.ts) — .gif and video extensions
// never get one. Uploads made before that feature shipped also won't have
// one even if their extension is in this set; callers should fall back to
// the plain (non-variant) URL on a load error for that case.
const THUMBNAIL_ELIGIBLE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.heic',
    '.heif',
    '.mp4',
    '.mov',
    '.m4v',
    '.webm',
]);
// Media-proxy URLs (/api/media/assets/<linkId>/<assetId>/<variant>.<ext>, and
// the legacy /api/immich/assets/... shape) carry the rendition as the last
// path segment, not in the filename — the backend's parseMediaAssetPath only
// accepts thumbnail.jpg/preview.jpg/original.<ext>, so a `-thumbnail.jpg`
// suffix there 404s (issue #386). Swap the segment instead.
const MEDIA_PROXY_ASSET_PATH = /^(\/api\/(?:media|immich)\/assets\/[^/]+\/[^/]+\/)[^/]+$/;
function toThumbnailPath(path) {
    const proxyMatch = path.match(MEDIA_PROXY_ASSET_PATH);
    if (proxyMatch)
        return `${proxyMatch[1]}thumbnail.jpg`;
    // Only local uploads have -thumbnail.jpg siblings; any other shape (an
    // external URL, an unknown path) is left as-is rather than guessed at.
    if (!path.startsWith('/uploads/'))
        return path;
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
        headers: {
            'Content-Type': undefined,
            ...(sessionId ? { 'X-Upload-Session-Id': sessionId } : {}),
            ...(excludedKeys.length ? { 'X-Upload-Session-Exclude': JSON.stringify(excludedKeys) } : {}),
        },
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
    return (url.match(/\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-thumbnail)?\.[a-z0-9]+(?:\?|$)/i)?.[1] ?? null);
}
async function fetchUploadProcessing(assetKey) {
    try {
        // requires-feature: uploadProcessing
        const response = await client_1.api.get(`/uploads/status/${assetKey}`);
        return response.data;
    }
    catch (error) {
        // Servers older than 0.8.7 have no status endpoint and 404 every request,
        // even though the upload itself loads fine — report it as ready so the UI
        // shows the photo instead of "processing failed" (null urls make callers
        // fall back to the original URL). Newer servers also 404 when the caller
        // can't read the upload, which is safe to map the same way: the image
        // request itself is refused too.
        if ((0, features_1.isNotFoundError)(error)) {
            return { status: 'ready', url: null, thumbnailUrl: null };
        }
        throw error;
    }
}
