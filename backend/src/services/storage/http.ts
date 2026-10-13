import type { FastifyReply } from 'fastify'
import { StorageError, type ByteRange, type StorageBackend } from './types.js'

// Parses a single-range `Range: bytes=...` header into a ByteRange, or null
// when there's none (or it's a form we don't support — multi-range, other
// units — which RFC 9110 lets a server answer with the full 200 body).
// A suffix range (`bytes=-500`) needs the object size to resolve.
export function parseRangeHeader(header: string | undefined, size: number): ByteRange | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const suffix = parseInt(match[2], 10)
    // `bytes=-0` asks for nothing: unsatisfiable, like a start past the end.
    return { start: suffix === 0 ? size : Math.max(0, size - suffix) }
  }
  return { start: parseInt(match[1], 10), end: match[2] ? parseInt(match[2], 10) : undefined }
}

// Sends one stored object as the response — 200, 206 for a satisfiable
// Range, 416 otherwise — or returns false without touching `reply` when the
// object doesn't exist, so the caller picks its own 404. The Range support
// isn't optional: native video players (iOS AVPlayer, Android ExoPlayer)
// refuse to play mp4s without it. Authorization is the caller's job
// (canReadUpload) and must happen before this.
export async function sendStoredObject(
  reply: FastifyReply,
  storage: StorageBackend,
  key: string,
  options: { contentType: string; rangeHeader?: string; cacheControl?: string }
): Promise<boolean> {
  const info = await storage.stat(key)
  if (!info) return false

  reply.header('content-type', options.contentType)
  reply.header('accept-ranges', 'bytes')
  reply.header('last-modified', info.lastModified.toUTCString())
  if (options.cacheControl) reply.header('cache-control', options.cacheControl)

  const range = parseRangeHeader(options.rangeHeader, info.size)
  let object
  try {
    object = await storage.get(key, range ? { range } : undefined)
  } catch (err) {
    if (err instanceof StorageError && err.code === 'invalid_range') {
      await reply.status(416).header('content-range', `bytes */${info.size}`).send()
      return true
    }
    throw err
  }
  // Deleted between stat() and get().
  if (!object) return false

  if (object.range) {
    reply.status(206)
    reply.header('content-range', `bytes ${object.range.start}-${object.range.end}/${object.size}`)
    reply.header('content-length', String(object.range.end - object.range.start + 1))
  } else {
    reply.header('content-length', String(object.size))
  }
  await reply.send(object.stream)
  return true
}
