import fsp from 'fs/promises';
import path from 'path';
import { prisma } from '../db.js';
import { uploadsDir } from '../config.js';
import { isCircleMember } from './circles.js';
import { DERIVED_DIR_NAME } from './uploadVariants.js';

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
// An upload's audience is set exactly once, by its own uploader, when it is
// first attached: only rows that are still unbound AND were uploaded by
// `uploaderId` are touched. Every attach site accepts any well-formed
// /uploads/ path from the client, so without both conditions anyone who knew
// a photo's URL could re-scope it — widen a circle-private photo to the whole
// server (e.g. by setting it as their avatar after being removed from the
// circle) or narrow someone else's family photo into a circle to hide it.
// Referencing an already-bound upload again (re-sharing, editing a post that
// keeps its photos) leaves its existing audience as-is, which can only fail
// closed: a circle photo reused elsewhere stays circle-only.
//
// Assets with no Upload row (server-side copies made by
// services/media/copyAsset.ts, or uploads predating the table) are simply
// not matched by the updateMany and stay on the legacy path — circle posts
// are single-group only, so copyAsset never runs for one.
export async function bindAssetsToScope(
  assetPaths: (string | null | undefined)[],
  circleId: string | null,
  uploaderId: string,
  tx: { upload: { updateMany: typeof prisma.upload.updateMany } } = prisma
): Promise<void> {
  const assetKeys = [...new Set(assetPaths.filter((p): p is string => !!p).map(uploadAssetKey))];
  if (assetKeys.length === 0) return;

  await tx.upload.updateMany({
    where: { assetKey: { in: assetKeys }, uploaderId, bound: false },
    data: { bound: true, circleId },
  });
  invalidateUploadCache(assetKeys);
}

// Is this upload a fresh, never-attached file that `userId` uploaded
// themselves? A Story requires exactly that (see routes/stories.ts): its
// photo is deleted from disk when the story expires, so it must never be a
// file some other post, comment or person also points at.
export async function isUnboundUploadOwnedBy(assetPath: string, userId: string): Promise<boolean> {
  const row = await prisma.upload.findUnique({
    where: { assetKey: uploadAssetKey(assetPath) },
    select: { uploaderId: true, bound: true },
  });
  return !!row && row.uploaderId === userId && !row.bound;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Every extension routes/uploads.ts can have written an original under.
const ORIGINAL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];

// Permanently removes every file one upload produced — the served copy, its
// -thumbnail.jpg, the never-served original, and any cached HEIC rendition
// under derived/ — plus its Upload row. Used only for story media, whose
// uploads are exclusive to the story (see isUnboundUploadOwnedBy above).
// Missing files are fine (a thumbnail that never generated, an original that
// was already a .jpg), so each unlink is best-effort.
export async function deleteUploadFiles(assetPath: string): Promise<void> {
  const assetKey = uploadAssetKey(assetPath);
  // The path was validated against UPLOAD_PATH_REGEX on the way in, but this
  // helper builds filesystem paths from it — refuse anything that isn't a
  // bare uuid rather than trust every future caller.
  if (!UUID_REGEX.test(assetKey)) return;

  const served = path.basename(assetPath);
  const candidates = [
    path.join(uploadsDir, served),
    path.join(uploadsDir, `${assetKey}-thumbnail.jpg`),
    ...ORIGINAL_EXTENSIONS.map((ext) => path.join(uploadsDir, 'originals', `${assetKey}${ext}`)),
    path.join(uploadsDir, DERIVED_DIR_NAME, `${assetKey}.jpg`),
    path.join(uploadsDir, DERIVED_DIR_NAME, `${assetKey}-thumbnail.jpg`),
  ];
  await Promise.all(candidates.map((p) => fsp.unlink(p).catch(() => {})));

  await prisma.upload.deleteMany({ where: { assetKey } });
  invalidateUploadCache([assetKey]);
}

// Atomically binds one fresh upload to `circleId` on behalf of its uploader,
// reporting whether it did. Unlike bindAssetsToScope (which silently leaves
// an already-bound or someone else's upload alone), a caller that needs the
// upload to be exclusively its own — a Story, whose photo is deleted from
// disk when it expires — uses this inside its transaction, so two concurrent
// requests can't both claim the same file.
export async function claimUnboundUpload(
  assetPath: string,
  uploaderId: string,
  circleId: string | null,
  tx: { upload: { updateMany: typeof prisma.upload.updateMany } } = prisma
): Promise<boolean> {
  const assetKey = uploadAssetKey(assetPath);
  const { count } = await tx.upload.updateMany({
    where: { assetKey, uploaderId, bound: false },
    data: { bound: true, circleId },
  });
  invalidateUploadCache([assetKey]);
  return count === 1;
}
