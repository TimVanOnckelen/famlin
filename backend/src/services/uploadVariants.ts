import { execFile } from 'child_process';
import { promisify } from 'util';
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
