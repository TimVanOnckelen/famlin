import { FastifyInstance } from 'fastify'
import fs from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { randomUUID } from 'crypto'
import { createMediaToken } from '../plugins/auth.js'
import { prisma } from '../db.js'
import { getT } from '../i18n/index.js'
import os from 'node:os'
import { getStorage } from '../services/storage/registry.js'
import {
  isConvertibleImage,
  isPosterableVideo,
  generateDisplayVariant,
  generateVideoPoster,
} from '../services/uploadVariants.js'
import { recordUpload } from '../services/uploads.js'

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
])

export default async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const t = getT(request)
      const storage = getStorage()
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-upload-'))
      const storedKeys: string[] = []
      const uploadedUrls: string[] = []
      async function cleanupStored() {
        // Report deletion failures instead of losing track of source copies.
        const results = await Promise.allSettled(storedKeys.map((key) => storage.delete(key)))
        const failure = results.find((r) => r.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      }
      try {
        for await (const part of request.parts()) {
          if (part.type !== 'file') continue
          const ext = path.extname(part.filename).toLowerCase()
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            part.file.resume()
            await cleanupStored()
            return reply.status(400).send({ error: t('errors.unsupportedFileType', { ext: ext || 'unknown' }) })
          }
          const uuid = randomUUID()
          const input = path.join(scratch, `${uuid}${ext}`)
          await pipeline(part.file, (await fs.open(input, 'w')).createWriteStream())
          if (part.file.truncated) {
            await cleanupStored()
            return reply.status(413).send({ error: t('errors.fileTooLarge') })
          }
          let servedKey = `${uuid}${ext}`
          const files = new Map<string, string>()
          const thumb = path.join(scratch, `${uuid}-thumbnail.jpg`)
          if (isConvertibleImage(ext)) {
            const display = path.join(scratch, `${uuid}-display.jpg`)
            const generated = generateDisplayVariant(input, display, thumb)
            // Both sharp pipelines must finish before scratch cleanup.
            const [displayResult, thumbnailResult] = await Promise.allSettled([generated.display, generated.thumbnail])
            if (displayResult.status === 'fulfilled') {
              servedKey = `${uuid}.jpg`
              files.set(`originals/${uuid}${ext}`, input)
              files.set(servedKey, display)
              if (thumbnailResult.status === 'fulfilled') files.set(`${uuid}-thumbnail.jpg`, thumb)
            } else files.set(servedKey, input)
          } else {
            files.set(servedKey, input)
            if (isPosterableVideo(ext)) {
              try {
                await generateVideoPoster(input, thumb)
                files.set(`${uuid}-thumbnail.jpg`, thumb)
              } catch {
                request.log.warn('Video poster generation failed')
              }
            }
          }
          // Authorization metadata exists before any file becomes readable.
          await recordUpload(`/uploads/${servedKey}`, request.user!.id)
          for (const [key, filePath] of files) {
            storedKeys.push(key)
            await storage.put(key, { filePath })
          }
          uploadedUrls.push(`/uploads/${servedKey}`)
          for (const filePath of new Set(files.values())) await fs.rm(filePath, { force: true })
        }
      } catch (err) {
        await cleanupStored()
        throw err
      } finally {
        await fs.rm(scratch, { recursive: true, force: true })
      }

      return { urls: uploadedUrls }
    }
  )

  // Authenticated: issues a short-lived, narrow-scope token that lets the
  // client read /uploads/* without embedding the full session token in every
  // image/video URL (see the onRequest hook in app.ts).
  fastify.get('/media-token', { preHandler: [fastify.authenticate] }, async (request) => {
    // Embed the caller's current tokenVersion so the media token is revoked
    // alongside their session on a password reset / deactivation.
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { tokenVersion: true },
    })
    return { token: createMediaToken(request.user!.id, user!.tokenVersion) }
  })
}
