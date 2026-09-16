import { prisma } from '../db.js';
import { isCircleMember } from './circles.js';

// Authorization for /uploads/* — see the Upload model in schema.prisma for
// why a reverse index table is the only practical way to answer "who is
// allowed to read this file".

const THUMBNAIL_SUFFIX = '-thumbnail';

// Maps any rendition of an upload back to the single key that identifies it:
//   uploads/<uuid>.jpg            -> <uuid>
//   uploads/<uuid>-thumbnail.jpg  -> <uuid>   (grid tile / video poster)
//   uploads/<uuid>.mp4            -> <uuid>
// A UUID never ends in "-thumbnail", so stripping that suffix is unambiguous.
// Getting this wrong would leave thumbnails unprotected, which is the whole
// asset at 400px — tests/circles-uploads.test.ts pins every rendition shape.
export function uploadAssetKey(pathOrFilename: string): string {
  const filename = pathOrFilename.split('/').pop() ?? '';
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  return stem.endsWith(THUMBNAIL_SUFFIX) ? stem.slice(0, -THUMBNAIL_SUFFIX.length) : stem;
}

type UploadRow = { assetKey: string; uploaderId: string | null; circleId: string | null; bound: boolean };

// Every /uploads/ request pays this lookup, so the rows are cached and
// invalidated on write (the getAllSettings pattern) rather than given a TTL:
// a stale "unbound" row would make a freshly posted photo unreadable to
// everyone else until it expired.
const rowCache = new Map<string, UploadRow | null>();
const ROW_CACHE_MAX = 5000;

function cacheRow(assetKey: string, row: UploadRow | null): void {
  // Cheap bound on memory: an LRU would be better, but this cache exists to
  // absorb repeat hits on a feed's worth of images, and dropping the oldest
  // insert is good enough for that.
  if (rowCache.size >= ROW_CACHE_MAX) {
    const oldest = rowCache.keys().next().value;
    if (oldest !== undefined) rowCache.delete(oldest);
  }
  rowCache.set(assetKey, row);
}

export function invalidateUploadCache(assetKeys?: string[]): void {
  if (!assetKeys) return rowCache.clear();
  for (const key of assetKeys) rowCache.delete(key);
}

async function getUploadRow(assetKey: string): Promise<UploadRow | null> {
  if (rowCache.has(assetKey)) return rowCache.get(assetKey) ?? null;
  const row = await prisma.upload.findUnique({
    where: { assetKey },
    select: { assetKey: true, uploaderId: true, circleId: true, bound: true },
  });
  cacheRow(assetKey, row);
  return row;
}

// Can `userId` read the file at this /uploads/ path?
//
//   - no row at all -> yes. Uploads predating the Upload table have no row,
//     and enforcement is deliberately forward-looking with no backfill, so
//     existing deployments keep serving their media unchanged.
//   - circle-scoped -> only members of that circle. A dangling circleId (the
//     circle was deleted) matches nobody, which is the intended fail-closed
//     behaviour: a deleted circle's media must not revert to family-wide.
//   - unbound       -> only the uploader. This is a composer draft that was
//     never attached to a post, comment, message or avatar.
//   - otherwise     -> any authenticated user, exactly as before Circles.
export async function canReadUpload(pathOrFilename: string, userId: string): Promise<boolean> {
  const row = await getUploadRow(uploadAssetKey(pathOrFilename));
  if (!row) return true;
  if (row.circleId) return isCircleMember(row.circleId, userId);
  if (!row.bound) return row.uploaderId === userId;
  return true;
}

// Called by POST /api/uploads for every file it writes. The row starts
// unbound: until the client actually attaches it to something, only the
// uploader can read it back.
export async function recordUpload(assetPath: string, uploaderId: string): Promise<void> {
  const assetKey = uploadAssetKey(assetPath);
  await prisma.upload.upsert({
    where: { assetKey },
    create: { assetKey, uploaderId },
    update: {},
  });
  invalidateUploadCache([assetKey]);
}

// THE single place an upload's audience is set. Called from every site that
// attaches an upload to something a user can see — post create/edit, comment
// create, chat message, avatar, circle avatar, and the trip check-in / album
// photo interactions. Passing circleId null means "whole family", which is
// what every non-circle attach site does.
//
// Assets with no Upload row (server-side copies made by
// services/media/copyAsset.ts, or uploads predating the table) are simply
// not matched by the updateMany and stay on the legacy path — circle posts
// are single-group only, so copyAsset never runs for one.
export async function bindAssetsToScope(
  assetPaths: (string | null | undefined)[],
  circleId: string | null,
  tx: { upload: { updateMany: typeof prisma.upload.updateMany } } = prisma
): Promise<void> {
  const assetKeys = [...new Set(assetPaths.filter((p): p is string => !!p).map(uploadAssetKey))];
  if (assetKeys.length === 0) return;

  await tx.upload.updateMany({
    where: { assetKey: { in: assetKeys } },
    data: { bound: true, circleId },
  });
  invalidateUploadCache(assetKeys);
}
