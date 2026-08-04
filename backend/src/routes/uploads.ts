import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import os from 'os';
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

// One descriptor per uploaded file, built while streaming the multipart body
// so its position in the array matches the order files arrived in. The
// post-processing phase below consumes these with bounded concurrency.
type PostProcessJob =
  | { kind: 'image'; index: number; uuid: string; ext: string; originalPath: string }
  | { kind: 'video'; uuid: string; filepath: string }
  | { kind: 'raw' };

// Simple index-cursor worker pool: `concurrency` workers each pull the next
// unclaimed item until the list is drained. Every item is always attempted —
// a failing item is recorded but doesn't stop the others — and the first
// error (if any) is rethrown only after every worker has settled, so the
// caller's cleanup() sees the full, final set of files written by both the
// streaming loop and this phase, never a partial one from an early abort.
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let firstError: unknown;
  let hasError = false;

  async function runWorker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        await worker(item);
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (hasError) throw firstError;
}

export default async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    // The limit counts individual files, not requests: clients upload one
    // file per request rather than batching a whole picked set into one
    // multipart body, so "60 uploads / 10 min" would otherwise mean 60
    // photos worth of requests, not 60 batches.
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 200, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const parts = request.parts();
      const writtenPaths: string[] = [];
      const uploadedUrls: string[] = [];
      const jobs: PostProcessJob[] = [];

      async function cleanup() {
        await Promise.all(writtenPaths.map((p) => fs.unlink(p).catch(() => {})));
      }

      try {
        // Multipart parts must be consumed strictly in order — busboy only
        // makes the next part available once the current one is fully
        // drained — so this loop does the minimum necessary fast I/O
        // (validate extension, stream bytes to disk, check truncation) and
        // defers every CPU-bound encode (sharp/ffmpeg) to the bounded
        // post-processing phase below.
        for await (const part of parts) {
          if (part.type !== 'file') continue;

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

            // Optimistic canonical URL — the display copy this file will get
            // once processed. Overwritten with a fallback URL by the
            // post-processing phase if sharp can't decode this file.
            const index = uploadedUrls.length;
            uploadedUrls.push(`/uploads/${uuid}.jpg`);
            jobs.push({ kind: 'image', index, uuid, ext, originalPath });
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
            jobs.push(isPosterableVideo(ext) ? { kind: 'video', uuid, filepath } : { kind: 'raw' });
          }
        }

        // Bounded-concurrency post-processing: sharp already runs its own
        // encodes on libvips' internal threadpool, so a high outer
        // concurrency here would oversubscribe the CPU rather than help —
        // keep it modest and capped to the machine's core count.
        const concurrency = Math.max(1, Math.min(4, os.cpus().length));
        await runWithConcurrency(jobs, concurrency, async (job) => {
          if (job.kind === 'image') {
            const displayFilename = `${job.uuid}.jpg`;
            const displayPath = path.join(uploadsDir, displayFilename);
            const thumbnailPath = path.join(uploadsDir, `${job.uuid}-thumbnail.jpg`);

            try {
              await generateUploadVariants(job.originalPath, displayPath, thumbnailPath);
              writtenPaths.push(displayPath, thumbnailPath);
              // uploadedUrls[job.index] already holds the correct display URL.
            } catch {
              // sharp couldn't decode this file (corrupt/unsupported) — fall
              // back to serving the raw upload as-is, exactly like before
              // this feature existed, instead of stranding it unreachably
              // in originals/.
              await fs.unlink(displayPath).catch(() => {});
              await fs.unlink(thumbnailPath).catch(() => {});
              const fallbackFilename = `${job.uuid}${job.ext}`;
              const fallbackPath = path.join(uploadsDir, fallbackFilename);
              await fs.rename(job.originalPath, fallbackPath);
              const originalIndex = writtenPaths.indexOf(job.originalPath);
              if (originalIndex !== -1) writtenPaths[originalIndex] = fallbackPath;
              uploadedUrls[job.index] = `/uploads/${fallbackFilename}`;
            }
          } else if (job.kind === 'video') {
            // Best-effort poster frame for video grid/list tiles. A missing
            // poster (ffmpeg absent, undecodable video) just means clients
            // fall back to rendering the video itself, as before this
            // feature existed — never a failed upload.
            const posterPath = path.join(uploadsDir, `${job.uuid}-thumbnail.jpg`);
            try {
              await generateVideoPoster(job.filepath, posterPath);
              writtenPaths.push(posterPath);
            } catch {
              await fs.unlink(posterPath).catch(() => {});
            }
          }
          // 'raw' (gif / non-posterable): nothing to do.
        });
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
