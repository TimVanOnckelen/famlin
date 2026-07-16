import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { createMediaToken } from '../plugins/auth.js';
import { prisma } from '../db.js';
import { getT } from '../i18n/index.js';
import {
  isConvertibleImage,
  isPosterableVideo,
  generateUploadVariants,
  generateVideoPoster,
} from '../services/uploadVariants.js';

const uploadsDir = path.join(process.cwd(), 'uploads');

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
  '.mp4', '.mov', '.m4v', '.webm',
]);

export default async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const parts = request.parts();
      const writtenPaths: string[] = [];
      const uploadedUrls: string[] = [];

      async function cleanup() {
        await Promise.all(writtenPaths.map((p) => fs.unlink(p).catch(() => {})));
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

            if (isConvertibleImage(ext)) {
              // The true original is kept for a possible future "download
              // original" feature but is never served (see the /uploads/
              // onRequest hook in app.ts) — everything else derives from it.
              const originalPath = path.join(uploadsDir, 'originals', `${uuid}${ext}`);

              // Record the path before writing so a mid-stream failure (client
              // abort, disk error) still gets cleaned up by the catch below.
              writtenPaths.push(originalPath);
              await pipeline(part.file, (await fs.open(originalPath, 'w')).createWriteStream());

              if (part.file.truncated) {
                await cleanup();
                return reply.status(413).send({ error: t('errors.fileTooLarge') });
              }

              const displayFilename = `${uuid}.jpg`;
              const displayPath = path.join(uploadsDir, displayFilename);
              const thumbnailPath = path.join(uploadsDir, `${uuid}-thumbnail.jpg`);

              try {
                await generateUploadVariants(originalPath, displayPath, thumbnailPath);
                writtenPaths.push(displayPath, thumbnailPath);
                uploadedUrls.push(`/uploads/${displayFilename}`);
              } catch {
                // sharp couldn't decode this file (corrupt/unsupported) — fall
                // back to serving the raw upload as-is, exactly like before
                // this feature existed, instead of stranding it unreachably
                // in originals/.
                await fs.unlink(displayPath).catch(() => {});
                await fs.unlink(thumbnailPath).catch(() => {});
                const fallbackFilename = `${uuid}${ext}`;
                const fallbackPath = path.join(uploadsDir, fallbackFilename);
                await fs.rename(originalPath, fallbackPath);
                writtenPaths[writtenPaths.indexOf(originalPath)] = fallbackPath;
                uploadedUrls.push(`/uploads/${fallbackFilename}`);
              }
            } else {
              const filename = `${uuid}${ext}`;
              const filepath = path.join(uploadsDir, filename);

              writtenPaths.push(filepath);
              await pipeline(part.file, (await fs.open(filepath, 'w')).createWriteStream());

              if (part.file.truncated) {
                await cleanup();
                return reply.status(413).send({ error: t('errors.fileTooLarge') });
              }

              uploadedUrls.push(`/uploads/${filename}`);

              // Best-effort poster frame for video grid/list tiles. A missing
              // poster (ffmpeg absent, undecodable video) just means clients
              // fall back to rendering the video itself, as before this
              // feature existed — never a failed upload.
              if (isPosterableVideo(ext)) {
                const posterPath = path.join(uploadsDir, `${uuid}-thumbnail.jpg`);
                try {
                  await generateVideoPoster(filepath, posterPath);
                  writtenPaths.push(posterPath);
                } catch {
                  await fs.unlink(posterPath).catch(() => {});
                }
              }
            }
          }
        }
      } catch (err) {
        await cleanup();
        throw err;
      }

      return { urls: uploadedUrls };
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
