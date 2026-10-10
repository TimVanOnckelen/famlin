import { uploadSourcePath } from './uploadSources.js';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { prisma } from '../db.js';
import { uploadsDir } from '../config.js';

const exec = promisify(execFile);

// Preview work is intentionally small; full-size encoding is a separate job.
export async function createUploadPreview(source: string, target: string, video: boolean) {
  if (video) {
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', source,
      '-frames:v', '1', '-vf', 'scale=400:400:force_original_aspect_ratio=decrease', target],
    { timeout: 30_000, maxBuffer: 1024 * 1024 });
  } else {
    await sharp(source).rotate().resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toFile(target);
  }
}

export async function convertUpload(source: string, target: string, video: boolean) {
  if (video) {
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', target],
    { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 });
  } else {
    await sharp(source).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toFile(target);
  }
}

export function startUploadWorker(log: { warn: (error: unknown, message: string) => void }) {
  let stopped = false;
  let running: Promise<void> | undefined;
  async function drain() {
    // A crashed job can be reclaimed; conversion timeout is shorter than this lease.
    await prisma.upload.updateMany({
      where: { processingStatus: 'processing', processingStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { processingStatus: 'queued' },
    });
    while (!stopped) {
      const job = await prisma.upload.findFirst({ where: { processingStatus: 'queued' }, orderBy: { createdAt: 'asc' } });
      if (!job) return;
      const claimed = await prisma.upload.updateMany({ where: { id: job.id, processingStatus: 'queued' },
        data: { processingStatus: 'processing', processingStartedAt: new Date() } });
      if (!claimed.count) continue;
      if (!job.sourceFilename || !job.mediaUrl) {
        await prisma.upload.updateMany({ where: { id: job.id }, data: { processingStatus: 'failed', processingError: 'Missing source' } });
        continue;
      }
      const source = uploadSourcePath(job.sourceFilename);
      const target = path.join(uploadsDir, path.basename(job.mediaUrl));
      const temporary = path.join(uploadsDir, 'originals', `${job.assetKey}.processing`);
      try {
        await convertUpload(source, temporary, target.endsWith('.mp4'));
        // Story expiry may delete this upload while encoding is running.
        if (!(await prisma.upload.findUnique({ where: { id: job.id }, select: { id: true } }))) {
          await fs.unlink(temporary).catch(() => {});
          continue;
        }
        await fs.rename(temporary, target);
        await prisma.upload.updateMany({ where: { id: job.id }, data: { processingStatus: 'ready', processingError: null } });
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        log.warn(error, 'Upload conversion failed');
        await prisma.upload.updateMany({ where: { id: job.id }, data: { processingStatus: 'failed', processingError: 'Conversion failed' } });
      }
    }
  }
  function tick() {
    if (!running && !stopped) {
      running = drain().catch((error) => log.warn(error, 'Upload worker failed')).finally(() => { running = undefined; });
    }
  }
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
