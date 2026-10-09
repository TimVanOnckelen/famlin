import { uploadSourcePath } from './uploadSources.js';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../db.js';
import { invalidateUploadCache } from './uploads.js';
const exec = promisify(execFile);

export async function readLivePhotoIdentifier(sourceFilename: string): Promise<string | null> {
  const { stdout } = await exec('exiftool', ['-json', '-G1', '-a', '-ContentIdentifier', '-MediaGroupUUID', uploadSourcePath(sourceFilename)], { timeout: 15000, maxBuffer: 256 * 1024 });
  const rows: Record<string, unknown>[] = JSON.parse(stdout);
  if (rows.length !== 1 || rows[0].Error) throw new Error('Unreadable Live Photo metadata');
  const entry = Object.entries(rows[0]).find(([key, value]) => /(^|:)ContentIdentifier$/.test(key) && typeof value === 'string')
    ?? Object.entries(rows[0]).find(([key, value]) => /(^|:)MediaGroupUUID$/.test(key) && typeof value === 'string');
  return entry ? String(entry[1]).trim().toLowerCase() : null;
}

export async function reconcileUploadSession(sessionId: string, uploaderId: string, excludedKeys: string[] = []) {
  const result = await prisma.$transaction(async (tx) => {
    // Serialize concurrent completions of one user's draft, then lock media
    // rows against publication. Published uploads never re-enter a session.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${uploaderId}:${sessionId}`}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "Upload" WHERE "uploaderId" = ${uploaderId} AND "uploadSessionId" = ${sessionId} AND NOT "bound" ORDER BY "assetKey" FOR UPDATE`;
    if (excludedKeys.length) {
      const excluded = await tx.upload.findMany({ where: { assetKey: { in: excludedKeys }, uploaderId, uploadSessionId: sessionId, bound: false }, include: { livePhoto: true } });
      const affected = [...new Set(excluded.flatMap((row) => [row.assetKey, ...(row.motionAssetKey ? [row.motionAssetKey] : []), ...(row.livePhoto ? [row.livePhoto.assetKey] : [])]))];
      await tx.upload.updateMany({ where: { assetKey: { in: affected }, uploaderId, uploadSessionId: sessionId, bound: false }, data: { motionAssetKey: null, uploadSessionId: null } });
    }
    const uploads = await tx.upload.findMany({ where: { uploaderId, uploadSessionId: sessionId, bound: false }, orderBy: { createdAt: 'asc' }, include: { livePhoto: true } });
    const groups = new Map<string, typeof uploads>();
    for (const upload of uploads) {
      if (!upload.sourceFilename || !/\.(heic|heif|jpe?g|mov)$/i.test(upload.sourceFilename)) continue;
      const key = upload.livePhotoIdentifier ? `id:${upload.livePhotoIdentifier}` : `name:${path.parse(upload.sourceFilename).name.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), upload]);
    }
    for (const group of groups.values()) {
      const photos = group.filter((row) => /\.(heic|heif|jpe?g)$/i.test(row.sourceFilename!));
      const videos = group.filter((row) => /\.mov$/i.test(row.sourceFilename!));
      if (photos.length !== 1 || videos.length !== 1) continue;
      const [photo] = photos; const [video] = videos;
      if (photo.livePhoto || video.motionAssetKey || photo.motionAssetKey || video.livePhoto) continue;
      await tx.upload.update({ where: { assetKey: photo.assetKey }, data: { mediaKind: 'livePhoto', motionAssetKey: video.assetKey } });
    }
    return tx.upload.findMany({ where: { uploaderId, uploadSessionId: sessionId, bound: false, livePhoto: null }, orderBy: { createdAt: 'asc' }, include: { motionUpload: true } });
  });
  invalidateUploadCache();
  return result.map((row) => ({
    url: row.mediaUrl!, thumbnailUrl: row.thumbnailUrl,
    kind: row.motionUpload ? 'livePhoto' as const : row.mediaUrl?.endsWith('.mp4') ? 'video' as const : 'image' as const,
    videoUrl: row.motionUpload?.mediaUrl ?? null,
    status: [row.processingStatus, row.motionUpload?.processingStatus].includes('failed') ? 'failed' as const
      : [row.processingStatus, row.motionUpload?.processingStatus].includes('processing') ? 'processing' as const
        : [row.processingStatus, row.motionUpload?.processingStatus].includes('queued') ? 'queued' as const : 'ready' as const,
  }));
}
