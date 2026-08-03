import { execFile } from 'child_process';
import { promisify } from 'util';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

// Source extensions sharp can decode and re-encode into a smaller display
// copy. Deliberately excludes .gif (resizing without `{ animated: true }`
// collapses it to a first-frame still, breaking chat GIF reactions) and every
// video extension (no image pipeline applies).
const CONVERTIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export function isConvertibleImage(ext: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(ext.toLowerCase());
}

// Video extensions ffmpeg can extract a poster frame from — the video half of
// routes/uploads.ts's ALLOWED_EXTENSIONS.
const POSTERABLE_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export function isPosterableVideo(ext: string): boolean {
  return POSTERABLE_VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

const DISPLAY_WIDTH = 1920;
const THUMBNAIL_WIDTH = 400;

// Decodes the original once and branches into two independent resize/output
// pipelines via sharp's clone() — cheaper than calling sharp(originalPath)
// twice. The freshly written original isn't reachable by any URL yet (its
// path is chosen fresh per upload and only becomes known once this function
// returns and the route responds), so there's no concurrent reader to guard
// against and no atomic tmp+rename dance is needed here, unlike the cached
// renditions in services/media/local.ts.
export async function generateUploadVariants(
  originalPath: string,
  displayPath: string,
  thumbnailPath: string
): Promise<void> {
  const image = sharp(originalPath).rotate();

  await image
    .clone()
    .resize({ width: DISPLAY_WIDTH, height: DISPLAY_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(displayPath);

  await image
    .clone()
    .resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbnailPath);
}

// Extracts a poster frame from an uploaded video into the same
// `<uuid>-thumbnail.jpg` path convention images use, so clients can render
// video tiles as plain images (mobile falls back to mounting a real video
// player only when the poster is missing). ffmpeg's `thumbnail` filter picks
// a representative frame from the first ~100 instead of frame 0, which is
// black in many phone recordings. ffmpeg is installed by backend/Dockerfile;
// if it's absent (bare local dev) or the video is undecodable, this throws
// and the caller skips the poster — the video itself is still served as-is.
export async function generateVideoPoster(videoPath: string, posterPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i', videoPath,
      '-vf', `thumbnail,scale=${THUMBNAIL_WIDTH}:${THUMBNAIL_WIDTH}:force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', '4',
      posterPath,
    ],
    { timeout: 30_000 }
  );
}

// ---------------------------------------------------------------------------
// Legacy HEIC/HEIF renditions
// ---------------------------------------------------------------------------
//
// Every browser except Safari refuses to decode HEIC/HEIF, so an upload stored
// under its original extension renders as a broken image on the web app while
// the iOS app shows it fine. Two kinds of upload are stored that way: anything
// predating the conversion pipeline above (no backfill was ever run), and any
// upload whose conversion failed at the time (the fallback in routes/uploads.ts).
//
// Their `/uploads/<uuid>.heic` URLs are baked into Post.uploadedAssetUrls,
// Comment.attachmentUrls, chat messages and already-shipped clients, so they
// can't be rewritten. Instead the /uploads/ hook in app.ts serves a JPEG
// rendition under the very same URL, generated on first request and cached in
// uploads/derived/ (inside the uploads volume, so it survives restarts;
// blocked from being served directly, like originals/).

export const DERIVED_DIR_NAME = 'derived';

const HEIC_EXTENSIONS = ['.heic', '.heif'];

// Only the exact filename shape routes/uploads.ts writes — which also keeps
// anything path-traversal-ish from ever reaching the sharp/fs calls below.
const UPLOAD_FILENAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-thumbnail)?(\.[a-z0-9]+)$/i;

export type HeicRenditionPlan = {
  sourcePath: string;
  derivedPath: string;
  width: number;
  quality: number;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Decides whether a `/uploads/<file>` request should be answered with a
// generated JPEG instead of the bytes on disk. Returns null for every ordinary
// request (the overwhelming majority), which then falls through to
// @fastify/static untouched.
export async function planHeicRendition(
  uploadsDir: string,
  requestedFile: string
): Promise<HeicRenditionPlan | null> {
  const match = UPLOAD_FILENAME_RE.exec(requestedFile);
  if (!match) return null;
  const [, uuid, thumbnailSuffix, rawExt] = match;
  const ext = rawExt.toLowerCase();

  if (!thumbnailSuffix) {
    if (!HEIC_EXTENSIONS.includes(ext)) return null;
    return {
      sourcePath: path.join(uploadsDir, `${uuid}${ext}`),
      derivedPath: path.join(uploadsDir, DERIVED_DIR_NAME, `${uuid}.jpg`),
      width: DISPLAY_WIDTH,
      quality: 85,
    };
  }

  // A thumbnail request only concerns us when no real thumbnail was ever
  // generated — i.e. a legacy upload — so the on-disk file wins whenever it
  // exists and the hot path stays a single stat.
  if (ext !== '.jpg') return null;
  if (await exists(path.join(uploadsDir, requestedFile))) return null;

  for (const heicExt of HEIC_EXTENSIONS) {
    const sourcePath = path.join(uploadsDir, `${uuid}${heicExt}`);
    if (await exists(sourcePath)) {
      return {
        sourcePath,
        derivedPath: path.join(uploadsDir, DERIVED_DIR_NAME, `${uuid}-thumbnail.jpg`),
        width: THUMBNAIL_WIDTH,
        quality: 80,
      };
    }
  }
  return null;
}

// Decoding a 12MP HEIC costs hundreds of milliseconds, and a feed can request
// the same photo twice at once (hero + lightbox) — collapse concurrent misses
// onto one decode instead of racing two sharp pipelines over the same file.
const inFlight = new Map<string, Promise<string | null>>();

// Returns the path of a servable JPEG rendition, or null when the source can't
// be turned into one — a sharp build without HEIF support (the prebuilt
// binaries omit the patent-encumbered HEVC decoder; only backend/Dockerfile's
// production stage compiles against vips-heif), a corrupt file, an unwritable
// cache dir. The caller then serves the raw bytes exactly as it did before.
export async function ensureHeicRendition(plan: HeicRenditionPlan): Promise<string | null> {
  const pending = inFlight.get(plan.derivedPath);
  if (pending) return pending;

  const work = generateHeicRendition(plan).finally(() => inFlight.delete(plan.derivedPath));
  inFlight.set(plan.derivedPath, work);
  return work;
}

async function generateHeicRendition(plan: HeicRenditionPlan): Promise<string | null> {
  let sourceStat;
  try {
    sourceStat = await fsp.stat(plan.sourcePath);
  } catch {
    return null;
  }

  try {
    const derivedStat = await fsp.stat(plan.derivedPath);
    if (derivedStat.mtimeMs >= sourceStat.mtimeMs) return plan.derivedPath;
  } catch {
    // cache miss
  }

  const tmpPath = `${plan.derivedPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.mkdir(path.dirname(plan.derivedPath), { recursive: true });
    // rotate() applies the EXIF orientation before it's dropped with the rest
    // of the metadata — iPhone photos are routinely stored sideways.
    await sharp(plan.sourcePath)
      .rotate()
      .resize({ width: plan.width, height: plan.width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: plan.quality })
      .toFile(tmpPath);
    // Atomic swap so a concurrent reader never sees a half-written file.
    await fsp.rename(tmpPath, plan.derivedPath);
    return plan.derivedPath;
  } catch {
    await fsp.unlink(tmpPath).catch(() => {});
    return null;
  }
}
