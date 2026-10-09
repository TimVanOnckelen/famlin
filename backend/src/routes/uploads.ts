import { z } from 'zod';
import { readLivePhotoIdentifier, reconcileUploadSession } from '../services/livePhotos.js';
import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { createMediaToken } from '../plugins/auth.js';
import { prisma } from '../db.js';
import { getT } from '../i18n/index.js';
import { uploadsDir } from '../config.js';
import { isConvertibleImage, isPosterableVideo } from '../services/uploadVariants.js';
import { uploadAssetKey, invalidateUploadCache, canReadUpload } from '../services/uploads.js';
import { createUploadPreview, startUploadWorker } from '../services/uploadProcessing.js';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
  '.mp4', '.mov', '.m4v', '.webm',
]);

export default async function uploadRoutes(fastify: FastifyInstance) {
  let stopWorker: (() => Promise<void>) | undefined;
  fastify.addHook('onReady', async () => { stopWorker = startUploadWorker(fastify.log); });
  fastify.addHook('onClose', async () => { await stopWorker?.(); });

  fastify.get<{ Params: { assetKey: string } }>('/status/:assetKey', { preHandler: [fastify.authenticate], config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { assetKey } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetKey) ||
        !(await canReadUpload(`/uploads/${assetKey}.jpg`, request.user!.id))) {
      return reply.status(404).send({ error: getT(request)('errors.notFound') });
    }
    const upload = await prisma.upload.findUnique({ where: { assetKey }, include: { motionUpload: true } });
    reply.header('cache-control', 'no-store');
    const motion = upload?.motionUpload;
    const statuses = [upload?.processingStatus ?? 'ready', ...(motion ? [motion.processingStatus] : [])];
    const status = statuses.includes('failed') ? 'failed' : statuses.includes('processing') ? 'processing' : statuses.includes('queued') ? 'queued' : 'ready';
    return { status, url: upload?.mediaUrl ?? null, thumbnailUrl: upload?.thumbnailUrl ?? null,
      kind: motion ? 'livePhoto' : isPosterableVideo(path.extname(upload?.mediaUrl ?? '')) ? 'video' : 'image', videoUrl: motion?.mediaUrl ?? null };
  });
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const sessionId = z.string().uuid().optional().parse(request.headers['x-upload-session-id']);
      const excludedKeys = z.string().transform((value, context) => {
        try { return JSON.parse(value); }
        catch { context.addIssue({ code: 'custom', message: 'Invalid upload session exclusions' }); return z.NEVER; }
      }).pipe(z.array(z.string().uuid()).max(1000)).parse(String(request.headers['x-upload-session-exclude'] ?? '[]'));
      const parts = request.parts();
      const writtenPaths: string[] = [];
      const sourceDirectories: string[] = [];
      const uploadedUrls: string[] = [];
      const media: { url: string; thumbnailUrl: string | null; status: string }[] = [];
      const jobs: { assetKey: string; sourceFilename: string; uploadSessionId: string | null; livePhotoIdentifier: string | null; mediaKind: string; mediaUrl: string; thumbnailUrl: string | null }[] = [];

      async function cleanup() {
        await Promise.all(writtenPaths.map((p) => fs.unlink(p).catch(() => {})));
        await Promise.all(sourceDirectories.map((p) => fs.rmdir(p).catch(() => {})));
      }

      try {
        for await (const part of parts) {
          if (part.type === 'file') {
            const ext = path.extname(part.filename).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) {
              part.file.resume();
              await cleanup();
              return reply.status(400).send({ error: t('errors.unsupportedFileType', { ext: ext || 'unknown' }) });
            }
            const uuid = randomUUID();

            const video = isPosterableVideo(ext);
            const processMedia = video || isConvertibleImage(ext);
            const sourceFilename = processMedia ? `${uuid}/${path.basename(part.filename.replace(/\\/g, '/'))}` : `${uuid}${ext}`;
            const sourcePath = path.join(uploadsDir, ...(processMedia ? ['originals'] : []), sourceFilename);
            if (processMedia) {
              const sourceDirectory = path.dirname(sourcePath);
              await fs.mkdir(sourceDirectory, { recursive: true });
              sourceDirectories.push(sourceDirectory);
            }
            writtenPaths.push(sourcePath);
            await pipeline(part.file, (await fs.open(sourcePath, 'w')).createWriteStream());
            if (part.file.truncated) {
              await cleanup();
              return reply.status(413).send({ error: t('errors.fileTooLarge') });
            }
            const url = `/uploads/${uuid}${processMedia ? (video ? '.mp4' : '.jpg') : ext}`;
            let thumbnailUrl: string | null = null;
            if (processMedia) {
              const previewPath = path.join(uploadsDir, `${uuid}-thumbnail.jpg`);
              writtenPaths.push(previewPath);
              try {
                await createUploadPreview(sourcePath, previewPath, video);
                thumbnailUrl = `/uploads/${uuid}-thumbnail.jpg`;
              } catch (error) {
                request.log.warn({ err: error }, 'Upload preview generation failed');
                await fs.unlink(previewPath).catch(() => {});
              }
              let livePhotoIdentifier: string | null = null;
              let uploadSessionId = sessionId ?? null;
              if (sessionId && /\.(heic|heif|jpe?g|mov)$/i.test(sourceFilename)) {
                try { livePhotoIdentifier = await readLivePhotoIdentifier(sourceFilename); }
                catch (error) {
                  request.log.warn({ err: error }, 'Live Photo metadata unavailable; leaving file separate');
                  uploadSessionId = null;
                }
              }
              jobs.push({ assetKey: uuid, sourceFilename, uploadSessionId, livePhotoIdentifier, mediaKind: video ? 'video' : 'image', mediaUrl: url, thumbnailUrl });
            }
            uploadedUrls.push(url);
            media.push({ url, thumbnailUrl, status: processMedia ? 'queued' : 'ready' });
          }
        }
      } catch (err) {
        await cleanup();
        throw err;
      }

      try {
        // Publish jobs only after every source has been saved and authorized.
        await prisma.$transaction(async (tx) => {
          for (const url of uploadedUrls) {
            const job = jobs.find((item) => item.mediaUrl === url);
            if (job) {
              await tx.upload.create({ data: { ...job, uploaderId: request.user!.id, processingStatus: 'queued' } });
            } else {
              await tx.upload.create({ data: { assetKey: uploadAssetKey(url), uploaderId: request.user!.id, mediaUrl: url, uploadSessionId: sessionId ?? null } });
            }
          }
        });
        invalidateUploadCache(uploadedUrls.map(uploadAssetKey));
      } catch (error) {
        await cleanup();
        throw error;
      }
      const sessionMedia = sessionId ? await reconcileUploadSession(sessionId, request.user!.id, excludedKeys) : undefined;
      return { urls: uploadedUrls, media, ...(sessionMedia ? { sessionMedia } : {}) };
    }
  );

  // Authenticated: issues a short-lived, narrow-scope token that lets the
  // client read /uploads/* without embedding the full session token in every
  // image/video URL (see the onRequest hook in app.ts).
  fastify.get('/media-token', { preHandler: [fastify.authenticate] }, async (request) => {
    // Embed the caller's current tokenVersion so the media token is revoked
    // alongside their session on a password reset / deactivation.
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { tokenVersion: true },
    });
    return { token: createMediaToken(request.user!.id, user!.tokenVersion) };
  });
}
