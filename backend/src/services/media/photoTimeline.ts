import { prisma } from '../../db.js';
import { getMediaProvider } from './registry.js';
import { resolvePersonFilterForAlbum } from './personFilter.js';
import type { MediaAssetSummary } from './types.js';

// The merged, capture-date-ordered photo feed backing
// GET /api/media/groups/:groupId/photos — see routes/media.ts.
export interface PhotoItem {
  id: string;
  source: 'album' | 'post';
  type: 'IMAGE' | 'VIDEO';
  takenAt: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string;
  previewUrl: string;
  originalUrl: string;
  albumName?: string;
  linkId?: string;
  assetId?: string;
  postId?: string;
}

// --- Per-album asset listing cache -----------------------------------------
//
// listAlbumAssets() is a remote crawl (Immich) or a directory read (local),
// same cost profile as isAssetInAlbum()'s albumAssetIdsCache in immich.ts.
// The timeline paginates in-memory over every linked album's *full* asset
// list (see below), so without a cache a multi-page browse of the same grid
// would re-crawl every album once per page instead of once per minute.
// Mirrors albumAssetIdsCache's 60s TTL; kept local to this module rather than
// reusing immich.ts's cache since that one is Immich-specific and keyed
// differently (ids-only, not full summaries) — this needs to work for every
// provider.
interface AlbumAssetsCacheEntry {
  assets: MediaAssetSummary[];
  expiresAt: number;
}
const ALBUM_ASSETS_CACHE_TTL_MS = 60 * 1000;
const albumAssetsCache = new Map<string, AlbumAssetsCacheEntry>();

async function listAlbumAssetsCached(provider: string, externalAlbumId: string): Promise<MediaAssetSummary[]> {
  const key = `${provider}:${externalAlbumId}`;
  const cached = albumAssetsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.assets;

  const mediaProvider = getMediaProvider(provider);
  if (!mediaProvider) return [];

  const assets = await mediaProvider.listAlbumAssets(externalAlbumId);
  albumAssetsCache.set(key, { assets, expiresAt: Date.now() + ALBUM_ASSETS_CACHE_TTL_MS });
  return assets;
}

// Test-only escape hatch, mirrors __clearPersonTagCacheForTests — lets a test
// force a fresh crawl instead of waiting out the 60s TTL or leaking a stale
// entry into another test file.
export function __clearPhotoTimelineCacheForTests(): void {
  albumAssetsCache.clear();
}

// --- Keyset cursor -----------------------------------------------------
//
// Not services/pagination.ts's paginationArgs/paginate: that helper assumes
// a single Prisma query cursoring on a row's own `id` column. This endpoint
// merges two heterogeneous sources (provider albums + post uploads) into one
// in-memory list sorted by an effective timestamp, so the cursor instead
// encodes a (timestamp, id) position in that merged, sorted list.
function encodeCursor(takenAt: string, id: string): string {
  return Buffer.from(`${takenAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { takenAt: string; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('|');
  if (sep === -1) return null;
  return { takenAt: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

const UPLOAD_EXTENSION_TYPE: Record<string, 'IMAGE' | 'VIDEO'> = {
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  png: 'IMAGE',
  gif: 'IMAGE',
  webp: 'IMAGE',
  heic: 'IMAGE',
  heif: 'IMAGE',
  mp4: 'VIDEO',
  mov: 'VIDEO',
  m4v: 'VIDEO',
  webm: 'VIDEO',
};

function uploadAssetType(url: string): 'IMAGE' | 'VIDEO' {
  const ext = url.split('.').pop()?.toLowerCase() ?? '';
  return UPLOAD_EXTENSION_TYPE[ext] ?? 'IMAGE';
}

export type PhotoTimelineResult =
  | { ok: true; items: PhotoItem[]; nextCursor: string | null }
  | { ok: false; status: number; errorKey: string };

// Builds one group's merged photo timeline: every asset across the group's
// linked media albums, plus every directly-uploaded (/uploads/...) photo on
// the group's posts, ordered newest-capture-first.
export async function getGroupPhotoTimeline(
  groupId: string,
  options: { cursor?: string; take: number; personId?: string }
): Promise<PhotoTimelineResult> {
  // personId must be a mapped MediaPersonLink *somewhere* — mirrors the
  // single-album ?personId= filter's 404 (routes/media.ts). Checked once,
  // group-wide, rather than per-album: a provider the group happens to have
  // no linked album on shouldn't make an otherwise-valid personId look
  // unmapped, and a provider that simply isn't mapped for this personId
  // (while another linked album's provider is) just contributes zero photos
  // for that album below rather than erroring the whole request.
  if (options.personId) {
    const anyMapping = await prisma.mediaPersonLink.findFirst({ where: { externalPersonId: options.personId } });
    if (!anyMapping) return { ok: false, status: 404, errorKey: 'errors.mediaPersonLinkNotFound' };
  }

  const [links, posts] = await Promise.all([
    prisma.mediaAlbumLink.findMany({ where: { groupId } }),
    // Bounded at family scale: one findMany filtered to the group, selecting
    // only the columns a post-upload PhotoItem needs. Unbounded is fine here
    // — a family group's total post count stays in the tens/hundreds, not
    // millions — but this would need a date-window filter (or its own
    // pagination source) if that assumption ever stops holding.
    prisma.post.findMany({
      where: { groupId, uploadedAssetUrls: { isEmpty: false } },
      select: { id: true, createdAt: true, uploadedAssetUrls: true },
    }),
  ]);

  const items: PhotoItem[] = [];

  // Album side — per-link fail-soft: a failing provider/album (network
  // error, misconfigured source, deleted album) logs and contributes zero
  // photos, never fails the whole request. Mirrors GET /groups/:groupId/albums
  // and the personTags.ts fail-soft doctrine.
  await Promise.all(
    links.map(async (link) => {
      let personAssetIds: Set<string> | null = null;
      if (options.personId) {
        try {
          const result = await resolvePersonFilterForAlbum(link, options.personId);
          // Not ok here means either "this provider has no such mapping" or
          // "this provider can't filter by person at all" — neither is a
          // request-level error at the group level (see the comment above);
          // this album simply contributes nothing to a person-filtered
          // timeline.
          if (!result.ok) return;
          personAssetIds = result.assetIds;
        } catch (err) {
          console.warn(`photoTimeline: person filter failed for album link ${link.id}:`, err);
          return;
        }
      }

      try {
        const assets = await listAlbumAssetsCached(link.provider, link.externalAlbumId);
        for (const asset of assets) {
          if (personAssetIds && !personAssetIds.has(asset.id)) continue;
          const takenAt = asset.takenAt ?? asset.addedAt ?? new Date(0).toISOString();
          items.push({
            id: `album:${link.id}:${asset.id}`,
            source: 'album',
            type: asset.type,
            takenAt,
            width: asset.width,
            height: asset.height,
            thumbnailUrl: `/api/media/assets/${link.id}/${asset.id}/thumbnail.jpg`,
            previewUrl: `/api/media/assets/${link.id}/${asset.id}/preview.jpg`,
            originalUrl: `/api/media/assets/${link.id}/${asset.id}/original.${asset.originalExt}`,
            albumName: link.albumName,
            linkId: link.id,
            assetId: asset.id,
          });
        }
      } catch (err) {
        console.warn(`photoTimeline: failed to list assets for album link ${link.id}:`, err);
      }
    })
  );

  // Post-upload side — excluded entirely when person-filtering, since a
  // direct upload carries no face-tag data to filter on.
  if (!options.personId) {
    for (const post of posts) {
      post.uploadedAssetUrls.forEach((url, index) => {
        // Only bare /uploads/... paths. A media-proxy URL
        // (/api/media/assets/... or the legacy /api/immich/assets/...)
        // stored in a post's uploadedAssetUrls is an album asset the client
        // picked from the linked-album picker — it's already covered by the
        // album side above, so including it again here would duplicate it
        // in the merged feed.
        if (!url.startsWith('/uploads/')) return;
        items.push({
          id: `post:${post.id}:${index}`,
          source: 'post',
          type: uploadAssetType(url),
          takenAt: post.createdAt.toISOString(),
          width: null,
          height: null,
          // Uploads have no separate renditions — clients already render
          // post photos straight off this one URL.
          thumbnailUrl: url,
          previewUrl: url,
          originalUrl: url,
          postId: post.id,
        });
      });
    }
  }

  // Newest capture first; tiebreak descending by id for a stable order
  // between items sharing an exact timestamp (e.g. several uploads on the
  // same post).
  items.sort((a, b) => {
    if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  let startIndex = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    // An unparseable cursor is treated as "start from the top" rather than a
    // 400 — cursors are opaque to clients, so a malformed one can only come
    // from a stale/corrupted value, and refusing the whole request over it
    // would be a worse experience than just restarting the feed.
    if (decoded) {
      startIndex = items.findIndex(
        (item) => item.takenAt < decoded.takenAt || (item.takenAt === decoded.takenAt && item.id < decoded.id)
      );
      if (startIndex === -1) startIndex = items.length;
    }
  }

  const page = items.slice(startIndex, startIndex + options.take);
  const hasMore = startIndex + options.take < items.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.takenAt, last.id) : null;

  return { ok: true, items: page, nextCursor };
}
