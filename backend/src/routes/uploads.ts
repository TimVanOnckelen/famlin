import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { createMediaToken } from '../plugins/auth.js';
import { prisma } from '../db.js';
import { getT } from '../i18n/index.js';

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
            const filename = `${randomUUID()}${ext}`;
            const filepath = path.join(uploadsDir, filename);

            // Record the path before writing so a mid-stream failure (client
            // abort, disk error) still gets cleaned up by the catch below.
            writtenPaths.push(filepath);
            await pipeline(part.file, (await fs.open(filepath, 'w')).createWriteStream());

            if (part.file.truncated) {
              await cleanup();
              return reply.status(413).send({ error: t('errors.fileTooLarge') });
            }

            uploadedUrls.push(`/uploads/${filename}`);
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
