import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { getStorage, getStorageConfiguration } from './storage/registry.js'
import { withStorageKeys } from './storage/locks.js'
import { createUploadPreview } from './uploadProcessing.js'

// Older uploads can lack their `<uuid>-thumbnail.jpg` sibling: uploads that
// predate thumbnails, and ones whose request-time preview failed before the
// worker learned to backfill it (issue #386). Their URLs are already stored
// in posts, comments and chat, and clients request the thumbnail for grid
// tiles, so the /uploads/ handler in app.ts calls this on a miss: the
// thumbnail is generated once from the stored display copy (or a video's
// poster frame) with the same pipeline a fresh upload uses, and written under
// its real key, so every later request is a plain hit.
//
// HEIC/HEIF sources are handled by resolveStoredHeicRendition instead, and
// GIFs deliberately never get a thumbnail.

const THUMBNAIL_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-thumbnail\.jpg$/i
const IMAGE_SOURCES = ['.jpg', '.jpeg', '.png', '.webp']
const VIDEO_SOURCES = ['.mp4', '.mov', '.m4v', '.webm']

// Concurrent misses for one thumbnail (a feed rendering the same photo twice)
// share one decode. Different thumbnails are decoded at most MAX_CONCURRENT
// at a time, so a gallery full of legacy uploads can't saturate the CPU. A
// failed decode backs off for FAILURE_BACKOFF_MS instead of being retried on
// every request — and only that long, since a failure can be transient (an
// ffmpeg timeout under load).
const MAX_CONCURRENT = 2
const FAILURE_BACKOFF_MS = 10 * 60_000
const inflight = new Map<string, Promise<string | null>>()
const failedAt = new Map<string, number>()
let active = 0
const waiting: (() => void)[] = []

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await work()
  } finally {
    active--
    waiting.shift()?.()
  }
}

export function resolveMissingThumbnail(requestedFile: string): Promise<string | null> {
  const match = THUMBNAIL_RE.exec(requestedFile)
  if (!match) return Promise.resolve(null)
  const failed = failedAt.get(requestedFile)
  if (failed !== undefined) {
    if (Date.now() - failed < FAILURE_BACKOFF_MS) return Promise.resolve(null)
    failedAt.delete(requestedFile)
  }
  const pending = inflight.get(requestedFile)
  if (pending) return pending
  const work = withSlot(() => generate(match[1], requestedFile)).finally(() => inflight.delete(requestedFile))
  inflight.set(requestedFile, work)
  return work
}

async function generate(uuid: string, target: string): Promise<string | null> {
  const storage = getStorage()
  if (await storage.stat(target)) return target
  let source: string | null = null
  for (const ext of [...IMAGE_SOURCES, ...VIDEO_SOURCES])
    if (await storage.stat(`${uuid}${ext}`)) {
      source = `${uuid}${ext}`
      break
    }
  if (!source) return null
  const video = VIDEO_SOURCES.includes(path.extname(source))
  // Decode outside the storage lock: withStorageKeys holds a pooled DB
  // connection for its duration, and a decode can take seconds.
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-thumb-'))
  try {
    const object = await storage.get(source)
    if (!object) return null
    const input = path.join(temp, `input${path.extname(source)}`)
    try {
      await pipeline(object.stream, createWriteStream(input))
    } finally {
      object.stream.destroy()
    }
    const output = path.join(temp, 'thumbnail.jpg')
    try {
      await createUploadPreview(input, output, video)
    } catch {
      failedAt.set(target, Date.now())
      return null
    }
    // Publish under the same key locks as deletion/migration, re-checking the
    // source so a thumbnail is never written for an upload deleted meanwhile.
    const sourceKey = source
    return await withStorageKeys([sourceKey, target], async () => {
      if (await storage.stat(target)) return target
      if (!(await storage.stat(sourceKey))) return null
      await getStorageConfiguration().primary.backend.put(target, { filePath: output })
      return target
    })
  } finally {
    await fsp.rm(temp, { recursive: true, force: true })
  }
}
