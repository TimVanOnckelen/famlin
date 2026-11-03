import type { Readable } from 'stream'

// Where uploaded media physically lives — the local uploads volume today,
// or an S3-compatible bucket (issue #221). One file per driver in
// this directory, mirroring the MediaProvider pattern in services/media/.
//
// Contract notes:
// - Keys are the stored URL minus its `/uploads/` prefix (`<uuid>.jpg`,
//   `originals/<uuid>.heic`, `derived/<uuid>-thumbnail.jpg`), so moving a
//   file between drivers never changes a URL saved in the database. Every
//   driver must reject anything assertValidStorageKey() rejects — a key is
//   often derived from a request path, so this is a path-traversal guard,
//   not a nicety.
// - Media is always served through the backend (canReadUpload runs on every
//   request), so a driver never hands out direct/presigned URLs. get() must
//   honor `range` — native video players refuse to play mp4s without
//   206/Content-Range support (see sendStoredObject in ./http.ts).
// - put() must be atomic from a reader's point of view: a concurrent get()
//   sees the old object, the new one, or nothing — never a partial file.
//   Migration between drivers relies on this to be safely re-runnable.
// - A missing object is not an error: get()/stat() resolve to null and
//   delete() is a no-op. Anything else (permissions, network) throws — and
//   once get() has resolved to an object, its stream must be readable.
export interface StorageBackend {
  // Driver id, e.g. 'local'.
  readonly id: string

  // Called once at startup: create the root directory / verify the bucket
  // is reachable. Should fail loudly on misconfiguration rather than at the
  // first upload.
  init(): Promise<void>

  // Whether the backend can currently be written to — for the /health
  // check.
  isWritable(): Promise<boolean>

  // Stores `body` under `key`, replacing any existing object. A Buffer, a
  // stream, or `{ filePath }` (a local file — the common case, since
  // sharp/ffmpeg write their renditions to a temp folder first).
  put(key: string, body: StorageBody): Promise<void>

  // Opens an object for reading, optionally a byte range. null when the
  // object doesn't exist. The caller must consume or destroy the returned
  // stream.
  get(key: string, options?: { range?: ByteRange }): Promise<StoredObject | null>

  stat(key: string): Promise<StoredObjectInfo | null>

  delete(key: string): Promise<void>

  // Every stored object, in no particular order. Used by exports and by
  // driver-to-driver migration, which lists the old storage rather than
  // trusting the Upload table alone (uploads predating it have no row).
  list(): AsyncIterable<StoredObjectInfo>
}

// Any readable stream or async iterable, not just Node core's Readable — archiver/unzipper
// hand out `readable-stream` instances, which fail an instanceof check.
export type StorageBody = Buffer | NodeJS.ReadableStream | AsyncIterable<Uint8Array | string> | { filePath: string }

// `end` is inclusive, like HTTP; omitted = to the end of the object.
// `suffix` is the last N bytes (`Range: bytes=-N`), resolved against the
// object's size by the driver, so serving needs no separate stat() first.
export type ByteRange = { start: number; end?: number } | { suffix: number }

export interface StoredObjectInfo {
  key: string
  size: number
  lastModified: Date
}

export interface StoredObject extends StoredObjectInfo {
  stream: Readable
  // The range actually being streamed (clamped to the object's size), or
  // null for the whole object. `size` is always the full object size.
  range: { start: number; end: number } | null
}

// Thrown for an invalid key or an unsatisfiable range — expected, caller-
// facing failures, so callers can tell them apart from I/O errors. An
// invalid_range error carries the object's size for the 416 Content-Range.
export class StorageError extends Error {
  constructor(
    public code: 'invalid_key' | 'invalid_range',
    message: string,
    public size?: number
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

// No leading dot, which also rules out `.`/`..` segments and keeps keys
// disjoint from in-flight temp files and import's `.restore-*` work dirs.
const KEY_SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

// Keys are forward-slash relative paths built only from URL-safe segments:
// no leading slash, no empty or dot-leading segments, no backslashes. Every
// upload path Famlin writes fits this shape.
export function assertValidStorageKey(key: string): void {
  const valid = key.length > 0 && key.length <= 1024 && key.split('/').every((s) => KEY_SEGMENT_RE.test(s))
  if (!valid) throw new StorageError('invalid_key', `Invalid storage key: ${JSON.stringify(key)}`)
}

// Clamps a requested range to an object of `size` bytes, throwing
// StorageError('invalid_range') when it can't be satisfied (HTTP 416).
export function resolveByteRange(range: ByteRange, size: number): { start: number; end: number } {
  const fail = () => new StorageError('invalid_range', `Unsatisfiable range for ${size} bytes`, size)
  if ('suffix' in range) {
    // `bytes=-0` asks for nothing: unsatisfiable, like a start past the end.
    if (!Number.isInteger(range.suffix) || range.suffix <= 0 || size === 0) throw fail()
    return { start: Math.max(0, size - range.suffix), end: size - 1 }
  }
  const end = Math.min(range.end ?? size - 1, size - 1)
  if (
    !Number.isInteger(range.start) ||
    (range.end !== undefined && !Number.isInteger(range.end)) ||
    range.start < 0 ||
    range.start >= size ||
    range.start > end
  ) {
    throw fail()
  }
  return { start: range.start, end }
}
