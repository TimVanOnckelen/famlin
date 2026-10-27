// Pure logic behind sharing photos/videos into Famlin from the OS share sheet
// (issue #199) — kept free of native modules so it can be unit-tested.

/** The new-post composer's attachment cap — the in-app picker's
 * `selectionLimit`. A share never pushes a post past it. */
export const MAX_POST_ATTACHMENTS = 10

/** The in-app picker's `videoMaxDuration` (seconds). The OS picker enforces it
 * in its own UI; a shared file skips that UI, so it's checked in code. */
export const MAX_VIDEO_DURATION_SECONDS = 120

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
}

export interface ScreenedSharedFiles {
  accepted: IncomingSharedFile[]
  /** Not a photo/video format the composer accepts. */
  unsupported: number
  /** A video longer than the picker's duration limit. */
  tooLong: number
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

/** Drops whatever the in-app picker would have refused: unsupported formats
 * and over-long videos. A video whose duration the OS didn't report is let
 * through — there's nothing to check it against. */
export function screenSharedFiles(files: IncomingSharedFile[]): ScreenedSharedFiles {
  const result: ScreenedSharedFiles = { accepted: [], unsupported: 0, tooLong: 0 }
  for (const file of files) {
    if (!file.path || !isSupportedSharedMimeType(file.mimeType)) {
      result.unsupported++
    } else if (
      normalizeMimeType(file.mimeType).startsWith('video/') &&
      file.duration != null &&
      file.duration > MAX_VIDEO_DURATION_SECONDS * 1000
    ) {
      result.tooLong++
    } else {
      result.accepted.push(file)
    }
  }
  return result
}

/** Splits shared items into what still fits next to the composer's existing
 * attachments (`existingCount`) and how many are skipped over the cap. */
export function fitSharedItems<T>(existingCount: number, items: T[]): { toAttach: T[]; skipped: number } {
  const room = Math.max(0, MAX_POST_ATTACHMENTS - existingCount)
  const toAttach = items.slice(0, room)
  return { toAttach, skipped: items.length - toAttach.length }
}
