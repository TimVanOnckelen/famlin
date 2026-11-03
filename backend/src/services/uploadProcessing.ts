import { withUploadSource, uploadLifecycleKey } from './uploadSources.js'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import { prisma } from '../db.js'
import { getStorageConfiguration } from './storage/registry.js'
import { withStorageKeys } from './storage/locks.js'

const exec = promisify(execFile)

// Preview work is intentionally small; full-size encoding is a separate job.
export async function createUploadPreview(source: string, target: string, video: boolean) {
  if (video) {
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        'thumbnail,scale=400:400:force_original_aspect_ratio=decrease',
        target,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    )
  } else {
    await sharp(source)
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(target)
  }
}

export async function convertUpload(source: string, target: string, video: boolean) {
  if (video) {
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-vf',
        "scale=w='if(gte(iw,ih),min(1920,iw),min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),min(1920,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '2',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        target,
      ],
      { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 }
    )
  } else {
    await sharp(source)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(target)
  }
}

export function startUploadWorker(log: { warn: (error: unknown, message: string) => void }) {
  let stopped = false
  let running: Promise<void> | undefined
  async function drain() {
    // A crashed job can be reclaimed; conversion timeout is shorter than this lease.
    await prisma.upload.updateMany({
      where: { processingStatus: 'processing', processingStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { processingStatus: 'queued' },
    })
    while (!stopped) {
      const job = await prisma.upload.findFirst({
        where: { processingStatus: 'queued' },
        orderBy: { createdAt: 'asc' },
      })
      if (!job) return
      const claimed = await prisma.upload.updateMany({
        where: { id: job.id, processingStatus: 'queued' },
        data: { processingStatus: 'processing', processingStartedAt: new Date() },
      })
      if (!claimed.count) continue
      if (!job.sourceFilename || !job.mediaUrl) {
        await prisma.upload.updateMany({
          where: { id: job.id },
          data: { processingStatus: 'failed', processingError: 'Missing source' },
        })
        continue
      }
      const targetKey = path.basename(job.mediaUrl)
      try {
        await withUploadSource(job.sourceFilename, async (source, directory) => {
          const temporary = path.join(directory, `converted${path.extname(targetKey)}`)
          await convertUpload(source, temporary, targetKey.endsWith('.mp4'))
          // One lifecycle/key lock set coordinates deletion and migration.
          // Publishing and checking the row must happen under that same lock.
          await withStorageKeys([targetKey, uploadLifecycleKey(job.assetKey)], async (tx) => {
            if (!(await tx.upload.findUnique({ where: { id: job.id }, select: { id: true } }))) return
            await getStorageConfiguration().primary.backend.put(targetKey, { filePath: temporary })
            await tx.upload.updateMany({
              where: { id: job.id },
              data: { processingStatus: 'ready', processingError: null },
            })
          })
        })
      } catch (error) {
        log.warn(error, 'Upload conversion failed')
        await prisma.upload.updateMany({
          where: { id: job.id },
          data: { processingStatus: 'failed', processingError: 'Conversion failed' },
        })
      }
    }
  }
  function tick() {
    if (!running && !stopped) {
      running = drain()
        .catch((error) => log.warn(error, 'Upload worker failed'))
        .finally(() => {
          running = undefined
        })
    }
  }
  const timer = setInterval(tick, 1000)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await running
  }
}
