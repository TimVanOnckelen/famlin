import { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import type { Archiver } from 'archiver'
import type { FastifyBaseLogger } from 'fastify'
import { getStorage } from './registry.js'

// archiver.append() pipes every stream source into its own PassThrough at
// append time, which starts reading it immediately — so a plain stream (or
// Readable.from over an async generator) opens every stored object of the
// export at once. Instead each entry waits for one of a few open slots,
// granted in append order (the order archiver consumes entries in), so a
// large library never holds thousands of S3 responses or file descriptors.
const MAX_OPEN_OBJECTS = 4

class OpenSlots {
  private open = 0
  private readonly waiting: Array<() => void> = []
  acquire(grant: () => void) {
    if (this.open < MAX_OPEN_OBJECTS) {
      this.open++
      grant()
    } else {
      this.waiting.push(grant)
    }
  }
  cancel(grant: () => void) {
    const index = this.waiting.indexOf(grant)
    if (index !== -1) this.waiting.splice(index, 1)
  }
  release() {
    const next = this.waiting.shift()
    if (next) next()
    else this.open--
  }
}

interface ArchiveSources {
  slots: OpenSlots
  // Entry sources not yet closed, so abortArchive() can release them:
  // archiver's own abort() never destroys a source it is in the middle of
  // reading.
  open: Set<Readable>
}

const archiveSources = new WeakMap<Archiver, ArchiveSources>()

// A Readable over one stored object that opens it only once a slot is free
// and destroys the underlying object stream whenever it is itself destroyed,
// whether mid-read, while opening or while still waiting for a slot.
export function lazyStoredObjectStream(key: string, slots = new OpenSlots()): Readable {
  let source: Readable | null = null
  let started = false
  let holdsSlot = false
  const releaseSlot = () => {
    if (!holdsSlot) return
    holdsSlot = false
    slots.release()
  }
  const open = () => {
    holdsSlot = true
    if (readable.destroyed) return releaseSlot()
    getStorage()
      .get(key)
      .then(
        (object) => {
          if (readable.destroyed) {
            object?.stream.destroy()
            return releaseSlot()
          }
          if (!object) {
            readable.destroy(new Error('Export media disappeared'))
            return
          }
          source = object.stream
          source.on('data', (chunk) => {
            if (!readable.push(chunk)) source?.pause()
          })
          source.once('end', () => {
            releaseSlot()
            readable.push(null)
          })
          source.once('error', (err) => readable.destroy(err))
        },
        (err) => readable.destroy(err)
      )
  }
  const readable = new Readable({
    read() {
      if (source) {
        source.resume()
      } else if (!started) {
        started = true
        slots.acquire(open)
      }
    },
    destroy(err, callback) {
      slots.cancel(open)
      source?.destroy()
      releaseSlot()
      callback(err)
    },
  })
  return readable
}

export function appendStoredObject(archive: Archiver, key: string): void {
  let sources = archiveSources.get(archive)
  if (!sources) {
    sources = { slots: new OpenSlots(), open: new Set() }
    archiveSources.set(archive, sources)
  }
  const { open } = sources
  const readable = lazyStoredObjectStream(key, sources.slots)
  open.add(readable)
  readable.once('close', () => open.delete(readable))
  archive.append(readable, { name: `uploads/${key}` })
}

// Stops an archive whose consumer has gone away and closes every storage
// stream it still holds open (otherwise they linger until garbage collection
// closes the file handles, with a warning per descriptor).
export function abortArchive(archive: Archiver): void {
  archive.abort()
  for (const source of archiveSources.get(archive)?.open ?? []) source.destroy()
  archiveSources.delete(archive)
}

// For a route that streams `archive` as its response: abort it when the client
// disconnects (or a proxy cuts the response off) before it was fully sent.
export function abortArchiveOnDisconnect(archive: Archiver, response: ServerResponse, log: FastifyBaseLogger): void {
  response.once('close', () => {
    if (response.writableFinished) return
    log.info('export download closed before it finished; archive aborted')
    abortArchive(archive)
  })
}
