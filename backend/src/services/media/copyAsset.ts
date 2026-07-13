import path from 'path';
import fs from 'fs/promises';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { prisma } from '../../db.js';
import { parseMediaAssetPath } from '../../types.js';
import { getMediaProvider } from './registry.js';

// Same uploads directory routes/uploads.ts writes into — a copied asset ends
// up indistinguishable from a directly-uploaded one, which is the point: it
// lets a cross-posted sibling in a group without the source album linked
// still display the photo/video (see the module doc comment below).
const uploadsDir = path.join(process.cwd(), 'uploads');

// Thrown for expected, user-facing failures so the route can map it to a
// translated message instead of leaking fetch/fs internals (mirrors
// MediaProviderError in services/media/types.ts). `forbidden` covers an
// authorization failure (the asset's album isn't linked to one of the target
// groups, or the asset no longer belongs to that album); `unavailable`
// covers a provider read/write failure.
export class CrossPostAssetCopyError extends Error {
  constructor(public code: 'forbidden' | 'unavailable') {
    super(`cross-post asset copy failed: ${code}`);
    this.name = 'CrossPostAssetCopyError';
  }
}

// Cross-posting fans a post out into one Post row per target group (see
// routes/posts.ts POST /). A linked-album asset URL (see parseMediaAssetPath)
// is only readable through the MediaAlbumLink it came from, which belongs to
// exactly one group — so a sibling row in any *other* target group would 404
// trying to display it. This copies each such asset's bytes into a plain
// /uploads/ file (readable by any group, like a direct upload) and returns
// the url rewrite every sibling should use instead.
//
// Plain /uploads/* urls already in `urls` are left out of the returned map
// entirely — they're already group-agnostic, nothing to copy.
export async function copyMediaAssetsToUploads(
  urls: string[],
  allowedGroupIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const writtenPaths: string[] = [];

  try {
    for (const url of urls) {
      const parsed = parseMediaAssetPath(url);
      if (!parsed) continue;

      const link = await prisma.mediaAlbumLink.findUnique({ where: { id: parsed.linkId } });
      if (!link || !allowedGroupIds.includes(link.groupId)) {
        throw new CrossPostAssetCopyError('forbidden');
      }

      const provider = getMediaProvider(link.provider);
      if (!provider) {
        throw new CrossPostAssetCopyError('unavailable');
      }

      let inAlbum: boolean;
      try {
        inAlbum = await provider.isAssetInAlbum(link.externalAlbumId, parsed.assetId);
      } catch {
        throw new CrossPostAssetCopyError('unavailable');
      }
      if (!inAlbum) {
        throw new CrossPostAssetCopyError('forbidden');
      }

      let asset: { stream: NodeJS.ReadableStream; contentType?: string };
      try {
        asset = await provider.readAsset(link.externalAlbumId, parsed.assetId, 'original');
      } catch {
        throw new CrossPostAssetCopyError('unavailable');
      }

      // Reuses the real bytes' extension (as embedded in the proxy url this
      // post already carries) rather than trusting asset.contentType, same
      // as parseMediaAssetPath's own regex validation.
      const ext = path.extname(url);
      const filename = `${randomUUID()}${ext}`;
      const filepath = path.join(uploadsDir, filename);
      writtenPaths.push(filepath);

      try {
        await pipeline(asset.stream, (await fs.open(filepath, 'w')).createWriteStream());
      } catch {
        throw new CrossPostAssetCopyError('unavailable');
      }

      result.set(url, `/uploads/${filename}`);
    }
  } catch (err) {
    await Promise.all(writtenPaths.map((p) => fs.unlink(p).catch(() => {})));
    throw err;
  }

  return result;
}
