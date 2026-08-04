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
// HEIC/HEIF renditions
// ---------------------------------------------------------------------------
//
// No browser but Safari decodes HEIC/HEIF, so an upload stored under that
// extension is a broken image on the web app while the iOS app shows it fine.
// Uploads predating the conversion above are stored that way, and so is any
// upload whose conversion failed (the fallback in routes/uploads.ts). Their
// `/uploads/<uuid>.heic` URLs are already in Post.uploadedAssetUrls,
// Comment.attachmentUrls, chat messages and shipped clients, so converting the
// files in place isn't enough — the URL has to keep working. The /uploads/ hook
// in app.ts answers it with a JPEG instead, generated on first request by the
// same generateUploadVariants() a fresh upload runs (so the two can't drift
// apart) and cached in uploads/derived/, inside the uploads volume.

export const DERIVED_DIR_NAME = 'derived';

const HEIC_EXTENSIONS = ['.heic', '.heif'];

// Only the exact filename shape routes/uploads.ts writes — which also keeps
// anything path-traversal-ish from ever reaching the fs/sharp calls below.
const UPLOAD_FILENAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-thumbnail)?(\.[a-z0-9]+)$/i;

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Resolves a `/uploads/<file>` request to the JPEG that should answer it.
// Returns null for every ordinary request — the caller falls through to
// @fastify/static untouched — and also when the source can't be decoded (a
// sharp build without HEIF support, a corrupt file, an unwritable cache dir),
// so those keep being served as the raw stored bytes exactly as before.
export async function resolveHeicRendition(
  uploadsDir: string,
  requestedFile: string
): Promise<string | null> {
  const match = UPLOAD_FILENAME_RE.exec(requestedFile);
  if (!match) return null;
  const [, uuid, isThumbnail, rawExt] = match;
  const ext = rawExt.toLowerCase();

  let sourcePath: string | null = null;
  if (!isThumbnail) {
    if (HEIC_EXTENSIONS.includes(ext)) sourcePath = path.join(uploadsDir, `${uuid}${ext}`);
  } else if (ext === '.jpg' && !(await exists(path.join(uploadsDir, requestedFile)))) {
    // Only an upload that never got a thumbnail generated concerns us, so a
    // real one on disk wins and the ordinary path costs a single stat.
    for (const heicExt of HEIC_EXTENSIONS) {
      const candidate = path.join(uploadsDir, `${uuid}${heicExt}`);
      if (await exists(candidate)) {
        sourcePath = candidate;
        break;
      }
    }
  }
  if (!sourcePath) return null;

  const derivedDir = path.join(uploadsDir, DERIVED_DIR_NAME);
  const ready = await ensureRenditions(sourcePath, derivedDir, uuid);
  if (!ready) return null;
  return path.join(derivedDir, isThumbnail ? `${uuid}-thumbnail.jpg` : `${uuid}.jpg`);
}

// Decoding a 12MP HEIC costs hundreds of milliseconds, and one photo can be
// requested twice at once (a grid tile and the hero it opens into) — collapse
// concurrent misses onto a single generateUploadVariants() call, which itself
// produces both renditions from one decode.
const inFlight = new Map<string, Promise<boolean>>();

function ensureRenditions(sourcePath: string, derivedDir: string, uuid: string): Promise<boolean> {
  const pending = inFlight.get(uuid);
  if (pending) return pending;

  const work = generateRenditions(sourcePath, derivedDir, uuid).finally(() => inFlight.delete(uuid));
  inFlight.set(uuid, work);
  return work;
}

async function generateRenditions(
  sourcePath: string,
  derivedDir: string,
  uuid: string
): Promise<boolean> {
  let sourceStat;
  try {
    sourceStat = await fsp.stat(sourcePath);
  } catch {
    return false;
  }

  const displayPath = path.join(derivedDir, `${uuid}.jpg`);
  const thumbnailPath = path.join(derivedDir, `${uuid}-thumbnail.jpg`);
  try {
    // Both are written together, so the display copy's freshness stands for
    // the pair.
    const cached = await fsp.stat(displayPath);
    if (cached.mtimeMs >= sourceStat.mtimeMs) return true;
  } catch {
    // cache miss
  }

  const suffix = `${process.pid}.${Date.now()}.tmp`;
  const displayTmp = `${displayPath}.${suffix}`;
  const thumbnailTmp = `${thumbnailPath}.${suffix}`;
  try {
    await fsp.mkdir(derivedDir, { recursive: true });
    await generateUploadVariants(sourcePath, displayTmp, thumbnailTmp);
    // Atomic swaps so a concurrent reader never sees a half-written file.
    await fsp.rename(displayTmp, displayPath);
    await fsp.rename(thumbnailTmp, thumbnailPath);
    return true;
  } catch {
    await Promise.all([
      fsp.unlink(displayTmp).catch(() => {}),
      fsp.unlink(thumbnailTmp).catch(() => {}),
    ]);
    return false;
  }
}
