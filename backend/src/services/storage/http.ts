import { Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { StorageError, type ByteRange, type StorageBackend, type StoredObject } from './types.js'

// Parses a single-range `Range: bytes=...` header, or null when there's none
// or RFC 9110 says to ignore it — multi-range, other units, or a syntactically
// invalid spec like `bytes=5-2` — so the full 200 body is sent instead.
export function parseRangeHeader(header: string | undefined): ByteRange | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) return { suffix: parseInt(match[2], 10) }
  const start = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : undefined
  return end !== undefined && end < start ? null : { start, end }
}

// Where sendObject() reads from: `stat` is only called to answer a
// conditional request without opening the object.
export interface ObjectSource {
  stat(): Promise<{ size: number; lastModified: Date } | null>
  get(range?: ByteRange): Promise<Omit<StoredObject, 'key'> | null>
}

type SendOptions = { contentType: string; cacheControl?: string }

// Sends one object as the response — 304 when the client's cached copy is
// current, 200, 206 for a satisfiable Range, 416 otherwise — or returns
// false without touching `reply` when the object doesn't exist, so the
// caller picks its own 404. The Range support isn't optional: native video
// players (iOS AVPlayer, Android ExoPlayer) refuse to play mp4s without it.
// Authorization is the caller's job (canReadUpload) and must happen before
// this.
export async function sendObject(reply: FastifyReply, source: ObjectSource, options: SendOptions): Promise<boolean> {
  const { request } = reply
  // Conditionals take precedence over Range (RFC 9110 §13.2.2), so check
  // them before opening anything — one extra stat, on revalidations only.
  if (request.headers['if-none-match'] || request.headers['if-modified-since']) {
    const info = await source.stat()
    if (!info) return false
    if (isNotModified(request, info)) {
      setCommonHeaders(reply, info, options)
      await reply.status(304).send()
      return true
    }
  }

  // HEAD sends metadata without opening a body stream.
  if (request.method === 'HEAD') {
    const info = await source.stat()
    if (!info) return false
    setCommonHeaders(reply, info, options)
    // An empty stream also preserves Content-Length with Fastify's
    // automatically generated HEAD route (undefined payload resets it to 0).
    await reply.header('content-length', String(info.size)).send(Readable.from([]))
    return true
  }

  const ifRange = request.headers['if-range']
  let allowRange = true
  if (ifRange) {
    const info = await source.stat()
    if (!info) return false
    // Weak validators cannot satisfy If-Range.
    allowRange =
      !Number.isNaN(Date.parse(String(ifRange))) &&
      Math.floor(info.lastModified.getTime() / 1000) * 1000 <= Date.parse(String(ifRange))
  }
  const range = allowRange ? parseRangeHeader(request.headers.range) : null
  let object
  try {
    object = await source.get(range ?? undefined)
  } catch (err) {
    if (err instanceof StorageError && err.code === 'invalid_range') {
      await reply.status(416).header('content-range', `bytes */${err.size}`).send()
      return true
    }
    throw err
  }
  if (!object) return false

  setCommonHeaders(reply, object, options)
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

// sendObject() for a key in a StorageBackend.
export function sendStoredObject(
  reply: FastifyReply,
  storage: StorageBackend,
  key: string,
  options: SendOptions
): Promise<boolean> {
  return sendObject(
    reply,
    { stat: () => storage.stat(key), get: (range) => storage.get(key, range ? { range } : undefined) },
    options
  )
}

// Weak validator from size + mtime, the same shape @fastify/static uses.
function etagFor(info: { size: number; lastModified: Date }): string {
  return `W/"${info.size.toString(16)}-${info.lastModified.getTime().toString(16)}"`
}

function setCommonHeaders(reply: FastifyReply, info: { size: number; lastModified: Date }, options: SendOptions) {
  reply.header('content-type', options.contentType)
  reply.header('accept-ranges', 'bytes')
  reply.header('etag', etagFor(info))
  reply.header('last-modified', info.lastModified.toUTCString())
  if (options.cacheControl) reply.header('cache-control', options.cacheControl)
}

function isNotModified(request: FastifyRequest, info: { size: number; lastModified: Date }): boolean {
  const ifNoneMatch = request.headers['if-none-match']
  // If-None-Match wins over If-Modified-Since when both are sent.
  if (ifNoneMatch) {
    const etag = etagFor(info)
    return ifNoneMatch === '*' || ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag.slice(2))
  }
  const since = Date.parse(request.headers['if-modified-since'] ?? '')
  // HTTP dates have whole-second precision.
  return !Number.isNaN(since) && Math.floor(info.lastModified.getTime() / 1000) * 1000 <= since
}
