import sharp from 'sharp';

// Source extensions sharp can decode and re-encode into a smaller display
// copy. Deliberately excludes .gif (resizing without `{ animated: true }`
// collapses it to a first-frame still, breaking chat GIF reactions) and every
// video extension (no image pipeline applies).
const CONVERTIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

export function isConvertibleImage(ext: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(ext.toLowerCase());
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
