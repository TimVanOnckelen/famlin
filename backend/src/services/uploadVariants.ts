import { execFile } from 'child_process'
import { promisify } from 'util'
import fsp from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)

// Source extensions sharp can decode and re-encode into a smaller display
// copy. Deliberately excludes .gif (resizing without `{ animated: true }`
// collapses it to a first-frame still, breaking chat GIF reactions) and every
// video extension (no image pipeline applies).
const CONVERTIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])

export function isConvertibleImage(ext: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(ext.toLowerCase())
}

// Video extensions ffmpeg can extract a poster frame from — the video half of
// routes/uploads.ts's ALLOWED_EXTENSIONS.
const POSTERABLE_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])

export function isPosterableVideo(ext: string): boolean {
  return POSTERABLE_VIDEO_EXTENSIONS.has(ext.toLowerCase())
}

const DISPLAY_WIDTH = 1920
const THUMBNAIL_WIDTH = 400

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
  const image = sharp(originalPath).rotate()

  await image
    .clone()
    .resize({ width: DISPLAY_WIDTH, height: DISPLAY_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(displayPath)

  await image
    .clone()
    .resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbnailPath)
}

// Upload-route variant of the pair above: starts both resize pipelines from
// the same decoded source, but only waits for the display copy — the one
// URL the route actually returns to the client. The thumbnail's `.toFile()`
// keeps running after this resolves; the returned promise lets the caller
// observe/log its outcome without blocking the response on it. A failed or
// still-pending thumbnail just means `getUploadUrl(path, 'thumbnail')` 404s
// until it lands, which every client already falls back to the display copy
// for (MediaThumbnail.tsx's `fallbackUrl` prop) — the same fallback that
// already covers pre-thumbnail-feature uploads.
export function generateDisplayVariant(
  originalPath: string,
  displayPath: string,
  thumbnailPath: string
): { display: Promise<void>; thumbnail: Promise<void> } {
  const image = sharp(originalPath).rotate()

  const thumbnail = image
    .clone()
    .resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbnailPath)
    .then(() => {})

  const display = image
    .clone()
    .resize({ width: DISPLAY_WIDTH, height: DISPLAY_WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(displayPath)
    .then(() => {})

  return { display, thumbnail }
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
      '-i',
      videoPath,
      '-vf',
      `thumbnail,scale=${THUMBNAIL_WIDTH}:${THUMBNAIL_WIDTH}:force_original_aspect_ratio=decrease`,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      posterPath,
    ],
    { timeout: 30_000 }
  )
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
// apart) and cached under derived/ in the active storage backend.

export const DERIVED_DIR_NAME = 'derived'

const HEIC_EXTENSIONS = ['.heic', '.heif']

// Only the exact filename shape routes/uploads.ts writes — which also keeps
// anything path-traversal-ish from ever reaching the fs/sharp calls below.
const UPLOAD_FILENAME_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-thumbnail)?(\.[a-z0-9]+)$/i

// Backend renditions are materialized only while sharp runs. Storage I/O
// failures propagate; only a decoding failure falls back to the source.
export async function resolveStoredHeicRendition(requestedFile: string): Promise<string | null> {
  const { getStorage, getStorageConfiguration } = await import('./storage/registry.js')
  const { withStorageKeys } = await import('./storage/locks.js')
  const { default: os } = await import('node:os')
  const { pipeline } = await import('node:stream/promises')
  const { createWriteStream } = await import('node:fs')
  const storage = getStorage()
  const match = UPLOAD_FILENAME_RE.exec(requestedFile)
  if (!match) return null
  const [, uuid, thumbnail, rawExt] = match
  const ext = rawExt.toLowerCase()
  let source: string | null = null
  if (!thumbnail && HEIC_EXTENSIONS.includes(ext)) source = requestedFile
  if (thumbnail && ext === '.jpg' && !(await storage.stat(requestedFile))) {
    for (const e of HEIC_EXTENSIONS)
      if (await storage.stat(`${uuid}${e}`)) {
        source = `${uuid}${e}`
        break
      }
  }
  if (!source) return null
  const sourceKey = source
  const target = `derived/${uuid}${thumbnail ? '-thumbnail' : ''}.jpg`
  // Lock the source, shared with deletion/migration. Write derived objects
  // under their own key locks via the application backend.
  return withStorageKeys([sourceKey, `derived/${uuid}.jpg`, `derived/${uuid}-thumbnail.jpg`], async () => {
    const original = await storage.stat(sourceKey)
    if (!original) return null
    const cached = await storage.stat(target)
    if (cached && cached.lastModified >= original.lastModified) return target
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-heic-'))
    try {
      const object = await storage.get(sourceKey)
      if (!object) return null
      const input = path.join(temp, 'input')
      try {
        await pipeline(object.stream, createWriteStream(input))
      } finally {
        object.stream.destroy()
      }
      const display = path.join(temp, 'display.jpg'),
        thumb = path.join(temp, 'thumb.jpg')
      try {
        await generateUploadVariants(input, display, thumb)
      } catch {
        return null
      }
      await getStorageConfiguration().primary.backend.put(`derived/${uuid}.jpg`, { filePath: display })
      await getStorageConfiguration().primary.backend.put(`derived/${uuid}-thumbnail.jpg`, { filePath: thumb })
      return target
    } finally {
      await fsp.rm(temp, { recursive: true, force: true })
    }
  })
}
