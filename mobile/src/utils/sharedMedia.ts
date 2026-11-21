// Pure logic behind sharing photos/videos into Famlin from the OS share sheet
// (issue #199) — kept free of native modules so it can be unit-tested.

// The upload route's ALLOWED_EXTENSIONS (backend/src/routes/uploads.ts),
// expressed as mime types. Anything else is rejected before it's copied.
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
])

const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/webm': 'webm',
}

/** One file as the share-intent module reports it (expo-share-intent's
 * `ShareIntentFile`, restated so this module doesn't import it). */
export interface IncomingSharedFile {
  path: string
  mimeType: string | null
  fileName: string | null
  width: number | null
  height: number | null
  /** Milliseconds, for videos; null when the OS didn't report it. */
  duration: number | null
}

/** A shared photo/video accepted for the composer, already copied into the
 * app's own cache directory. */
export interface SharedMediaItem {
  uri: string
  mimeType: string
  fileName: string
  isVideo: boolean
  width: number | null
  height: number | null
  /** Milliseconds, for videos; null when the OS didn't report it. */
  duration: number | null
}

export interface ScreenedSharedFiles {
  accepted: IncomingSharedFile[]
  /** Not a photo/video format the composer accepts. */
  unsupported: number
}

export function normalizeMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').toLowerCase().split(';')[0].trim()
}

export function isSupportedSharedMimeType(mimeType: string | null | undefined): boolean {
  return SUPPORTED_MIME_TYPES.has(normalizeMimeType(mimeType))
}

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_FOR_MIME[normalizeMimeType(mimeType)] ?? 'bin'
}

/** Drops formats the in-app picker would have refused. */
export function screenSharedFiles(files: IncomingSharedFile[]): ScreenedSharedFiles {
  const result: ScreenedSharedFiles = { accepted: [], unsupported: 0 }
  for (const file of files) {
    if (!file.path || !isSupportedSharedMimeType(file.mimeType)) result.unsupported++
    else result.accepted.push(file)
  }
  return result
}

/** Applies the server's limits (issue #436) to shared items once the composer
 * takes them — a share can arrive before the server's limits are known. Drops
 * videos over the duration limit, which the in-app picker enforces in its own
 * UI (one whose duration the OS didn't report is let through), then splits the
 * rest into what still fits next to the composer's existing attachments
 * (`existingCount`) and how many are skipped over the attachment cap. */
export function fitSharedItems(
  existingCount: number,
  items: SharedMediaItem[],
  limits: { maxAttachments: number; maxVideoDurationSeconds: number }
): { toAttach: SharedMediaItem[]; skipped: number; tooLong: number } {
  const allowed = items.filter(
    (item) => !item.isVideo || item.duration == null || item.duration <= limits.maxVideoDurationSeconds * 1000
  )
  const room = Math.max(0, limits.maxAttachments - existingCount)
  const toAttach = allowed.slice(0, room)
  return { toAttach, skipped: allowed.length - toAttach.length, tooLong: items.length - allowed.length }
}
