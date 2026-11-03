import { shapeUploadProcessing } from '../services/uploadMetadata.js'
import { z } from 'zod'
import { readLivePhotoIdentifier, reconcileUploadSession } from '../services/livePhotos.js'
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
import { uploadSourceKey } from '../services/uploadSources.js'
import { isConvertibleImage, isPosterableVideo } from '../services/uploadVariants.js'
import { uploadAssetKey, invalidateUploadCache, canReadUpload } from '../services/uploads.js'
import { createUploadPreview, startUploadWorker } from '../services/uploadProcessing.js'

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
  let stopWorker: (() => Promise<void>) | undefined
  fastify.addHook('onReady', async () => {
    stopWorker = startUploadWorker(fastify.log)
  })
  fastify.addHook('onClose', async () => {
    await stopWorker?.()
  })

  fastify.get<{ Params: { assetKey: string } }>(
    '/status/:assetKey',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { assetKey } = request.params
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetKey) ||
        !(await canReadUpload(`/uploads/${assetKey}.jpg`, request.user!.id))
      ) {
        return reply.status(404).send({ error: getT(request)('errors.notFound') })
      }
      const upload = await prisma.upload.findUnique({ where: { assetKey }, include: { motionUpload: true } })
      reply.header('cache-control', 'no-store')
      return shapeUploadProcessing(upload)
    }
  )
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const t = getT(request)
      const sessionId = z.string().uuid().optional().parse(request.headers['x-upload-session-id'])
      const excludedKeys = z
        .string()
        .transform((value, context) => {
          try {
            return JSON.parse(value)
          } catch {
            context.addIssue({ code: 'custom', message: 'Invalid upload session exclusions' })
            return z.NEVER
          }
        })
        .pipe(z.array(z.string().uuid()).max(1000))
        .parse(String(request.headers['x-upload-session-exclude'] ?? '[]'))
      const parts = request.parts()
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-upload-'))
      const storedKeys: string[] = []
      const storage = getStorage()
      const uploadedUrls: string[] = []
      const media: { url: string; thumbnailUrl: string | null; status: string }[] = []
      const jobs: {
        assetKey: string
        sourceFilename: string
        uploadSessionId: string | null
        livePhotoIdentifier: string | null
        mediaKind: string
        mediaUrl: string
        thumbnailUrl: string | null
      }[] = []

      async function cleanup() {
        const results = await Promise.allSettled(storedKeys.map((key) => storage.delete(key)))
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      }
      try {
        try {
          for await (const part of parts) {
            if (part.type === 'file') {
              const ext = path.extname(part.filename).toLowerCase()
              if (!ALLOWED_EXTENSIONS.has(ext)) {
                part.file.resume()
                await cleanup()
                return reply.status(400).send({ error: t('errors.unsupportedFileType', { ext: ext || 'unknown' }) })
              }
              const uuid = randomUUID()

              const video = isPosterableVideo(ext)
              const processMedia = video || isConvertibleImage(ext)
              const sourceFilename = processMedia
                ? `${uuid}/${path.basename(part.filename.replace(/\\/g, '/'))}`
                : `${uuid}${ext}`
              const sourcePath = path.join(scratch, `${uuid}${ext}`)
              await pipeline(part.file, (await fs.open(sourcePath, 'w')).createWriteStream())
              if (part.file.truncated) {
                await cleanup()
                return reply.status(413).send({ error: t('errors.fileTooLarge') })
              }
              const url = `/uploads/${uuid}${processMedia ? (video ? '.mp4' : '.jpg') : ext}`
              let thumbnailUrl: string | null = null
              if (processMedia) {
                const previewPath = path.join(scratch, `${uuid}-thumbnail.jpg`)
                try {
                  await createUploadPreview(sourcePath, previewPath, video)
                  thumbnailUrl = `/uploads/${uuid}-thumbnail.jpg`
                } catch (error) {
                  request.log.warn({ err: error }, 'Upload preview generation failed')
                  await fs.unlink(previewPath).catch(() => {})
                }
                if (thumbnailUrl) {
                  const key = `${uuid}-thumbnail.jpg`
                  storedKeys.push(key)
                  await storage.put(key, { filePath: previewPath })
                }
                let livePhotoIdentifier: string | null = null
                let uploadSessionId = sessionId ?? null
                if (sessionId && /\.(heic|heif|jpe?g|mov)$/i.test(sourceFilename)) {
                  try {
                    livePhotoIdentifier = await readLivePhotoIdentifier(sourceFilename, sourcePath)
                  } catch (error) {
                    request.log.warn({ err: error }, 'Live Photo metadata unavailable; leaving file separate')
                    uploadSessionId = null
                  }
                }
                jobs.push({
                  assetKey: uuid,
                  sourceFilename,
                  uploadSessionId,
                  livePhotoIdentifier,
                  mediaKind: video ? 'video' : 'image',
                  mediaUrl: url,
                  thumbnailUrl,
                })
              }
              const sourceKey = processMedia ? uploadSourceKey(sourceFilename) : `${uuid}${ext}`
              storedKeys.push(sourceKey)
              await storage.put(sourceKey, { filePath: sourcePath })
              uploadedUrls.push(url)
              media.push({ url, thumbnailUrl, status: processMedia ? 'queued' : 'ready' })
            }
          }
        } catch (err) {
          await cleanup()
          throw err
        }

        try {
          // Publish jobs only after every source has been saved and authorized.
          await prisma.$transaction(async (tx) => {
            for (const url of uploadedUrls) {
              const job = jobs.find((item) => item.mediaUrl === url)
              if (job) {
                await tx.upload.create({ data: { ...job, uploaderId: request.user!.id, processingStatus: 'queued' } })
              } else {
                await tx.upload.create({
                  data: {
                    assetKey: uploadAssetKey(url),
                    uploaderId: request.user!.id,
                    mediaUrl: url,
                    uploadSessionId: sessionId ?? null,
                  },
                })
              }
            }
          })
          invalidateUploadCache(uploadedUrls.map(uploadAssetKey))
        } catch (error) {
          await cleanup()
          throw error
        }
        const sessionMedia = sessionId
          ? await reconcileUploadSession(sessionId, request.user!.id, excludedKeys)
          : undefined
        return { urls: uploadedUrls, media, ...(sessionMedia ? { sessionMedia } : {}) }
      } finally {
        await fs.rm(scratch, { recursive: true, force: true })
      }
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
