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
// share one decode; a source that can't be decoded is not retried on every
// request for the life of the process.
const inflight = new Map<string, Promise<string | null>>()
const undecodable = new Set<string>()

export function resolveMissingThumbnail(requestedFile: string): Promise<string | null> {
  const match = THUMBNAIL_RE.exec(requestedFile)
  if (!match || undecodable.has(requestedFile)) return Promise.resolve(null)
  const pending = inflight.get(requestedFile)
  if (pending) return pending
  const work = generate(match[1], requestedFile).finally(() => inflight.delete(requestedFile))
  inflight.set(requestedFile, work)
  return work
}

async function generate(uuid: string, target: string): Promise<string | null> {
  const storage = getStorage()
  if (await storage.stat(target)) return target
  let sourceKey: string | null = null
  for (const ext of [...IMAGE_SOURCES, ...VIDEO_SOURCES])
    if (await storage.stat(`${uuid}${ext}`)) {
      sourceKey = `${uuid}${ext}`
      break
    }
  if (!sourceKey) return null
  const source = sourceKey
  const video = VIDEO_SOURCES.includes(path.extname(source))
  // Same key locks as deletion/migration, so a thumbnail is never written
  // for an upload that is being deleted or moved.
  return withStorageKeys([source, target], async () => {
    if (await storage.stat(target)) return target
    const object = await storage.get(source)
    if (!object) return null
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-thumb-'))
    try {
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
        undecodable.add(target)
        return null
      }
      await getStorageConfiguration().primary.backend.put(target, { filePath: output })
      return target
    } finally {
      await fsp.rm(temp, { recursive: true, force: true })
    }
  })
}
