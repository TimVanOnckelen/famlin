import { Readable } from 'node:stream'
import type { Archiver } from 'archiver'
import { getStorage } from './registry.js'

// Open each object lazily as archiver consumes it: a large library must not
// leave thousands of open S3 responses or local file descriptors waiting.
export function appendStoredObject(archive: Archiver, key: string): void {
  archive.append(
    Readable.from(
      (async function* () {
        const object = await getStorage().get(key)
        if (!object) throw new Error('Export media disappeared')
        try {
          yield* object.stream
        } finally {
          object.stream.destroy()
        }
      })()
    ),
    { name: `uploads/${key}` }
  )
}
