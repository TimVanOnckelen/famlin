import type { FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { getImmichSettings } from '../settings.js';
import { MediaProviderError, type MediaProvider, type MediaAssetVariant } from './types.js';

interface ImmichCreds {
  serverUrl: string;
  apiKey: string;
}

async function requireImmichSettings(): Promise<ImmichCreds> {
  const { serverUrl, apiKey, configured } = await getImmichSettings();
  if (!configured) throw new MediaProviderError('immich', 'not_configured');
  return { serverUrl, apiKey };
}

// `allow404` lets a caller (getAlbumInfo) distinguish "album was deleted on
// the Immich side" from a real failure instead of it collapsing into the
// generic `unreachable` error below.
async function immichFetch(
  path: string,
  creds: ImmichCreds,
  init?: RequestInit & { allow404?: boolean }
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${creds.serverUrl}/api${path}`, {
      ...init,
      headers: { 'x-api-key': creds.apiKey, Accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new MediaProviderError('immich', 'unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new MediaProviderError('immich', 'unauthorized');
  if (init?.allow404 && res.status === 404) return res;
  if (!res.ok) throw new MediaProviderError('immich', 'unreachable');
  return res;
}

// Takes explicit credentials (rather than reading saved settings) so the
// admin UI can test a server URL/API key before saving them.
export async function testImmichConnection(
  serverUrl: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: 'unreachable' | 'unauthorized' }> {
  const creds = { serverUrl: serverUrl.trim().replace(/\/$/, ''), apiKey: apiKey.trim() };
  try {
    await immichFetch('/server/about', creds);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof MediaProviderError && err.code === 'unauthorized' ? 'unauthorized' : 'unreachable',
    };
  }
}

const IMMICH_ALBUM_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Immich's GET /albums/:id doesn't return the album's assets
// (AlbumResponseDto has no `assets` field) — the documented way to list them
// is a metadata search scoped to the album via POST /search/metadata. `size`
// is capped at Immich's own max page size; a single page is plenty for a
// family album, so pagination (`nextPage`) isn't followed here.
async function searchAlbumAssets(immichAlbumId: string) {
  const creds = await requireImmichSettings();
  const res = await immichFetch('/search/metadata', creds, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumIds: [immichAlbumId], size: 1000 }),
  });
  const data = (await res.json()) as {
    assets: { items: Array<{ id: string; type: string; width: number | null; height: number | null }> };
  };
  return data.assets.items;
}

const albumAssetIdsCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const ALBUM_ASSETS_CACHE_TTL_MS = 60 * 1000;

export const immichProvider: MediaProvider = {
  id: 'immich',

  async isConfigured() {
    return (await getImmichSettings()).configured;
  },

  isValidAlbumId(externalAlbumId: string) {
    return IMMICH_ALBUM_ID_REGEX.test(externalAlbumId);
  },

  // For the admin's "link an album" picker.
  async listAlbums() {
    const creds = await requireImmichSettings();
    const res = await immichFetch('/albums', creds);
    const albums = (await res.json()) as Array<{ id: string; albumName: string; assetCount: number }>;
    return albums.map((a) => ({ id: a.id, name: a.albumName, assetCount: a.assetCount }));
  },

  // For the member-facing album list — fetches just one album's metadata
  // instead of listAlbums()'s full-instance catalog, so looking up a group's
  // linked album(s) doesn't scale with the size of the whole Immich library.
  // Returns null (rather than throwing) if the album was deleted on the
  // Immich side after being linked.
  async getAlbumInfo(externalAlbumId: string) {
    const creds = await requireImmichSettings();
    const res = await immichFetch(`/albums/${externalAlbumId}`, creds, { allow404: true });
    if (res.status === 404) return null;
    const data = (await res.json()) as { assetCount: number };
    return { assetCount: data.assetCount };
  },

  async listAlbumAssets(externalAlbumId: string) {
    const items = await searchAlbumAssets(externalAlbumId);
    return items.map((a) => ({
      id: a.id,
      type: (a.type === 'VIDEO' ? 'VIDEO' : 'IMAGE') as 'IMAGE' | 'VIDEO',
      width: a.width,
      height: a.height,
      // thumbnail/preview always come back from Immich as a JPEG still (even
      // for a video) — only the original rendition can be the real video file.
      originalExt: a.type === 'VIDEO' ? 'mp4' : 'jpg',
    }));
  },

  // The asset proxy routes re-check that a requested asset id actually
  // belongs to the linked album, not just that the linkId maps to a group the
  // requester is a member of — otherwise the server-level API key would let
  // any member read any asset on the whole Immich instance, including albums
  // never linked to Famlin, once they learn an asset id from elsewhere (e.g.
  // another group's post). Cached briefly and in-memory, matching the other
  // short-lived single-instance caches in this codebase (getAllSettings,
  // discoveryCache), so an image grid doesn't trigger one Immich search per
  // tile.
  async isAssetInAlbum(externalAlbumId: string, assetId: string) {
    const cached = albumAssetIdsCache.get(externalAlbumId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ids.has(assetId);
    }

    const items = await searchAlbumAssets(externalAlbumId);
    const ids = new Set(items.map((a) => a.id));
    albumAssetIdsCache.set(externalAlbumId, { ids, expiresAt: Date.now() + ALBUM_ASSETS_CACHE_TTL_MS });
    return ids.has(assetId);
  },

  // Streams a rendition straight from Immich into the response — mirrors how
  // routes/uploads.ts serves local files, but proxied. `thumbnail` (small,
  // grid-sized) and `preview` (larger — what Immich's own web viewer
  // displays, well short of the original's file size) both hit the same
  // endpoint with a different `size`; `original` is the true source file.
  async streamAsset(
    _externalAlbumId: string,
    assetId: string,
    variant: MediaAssetVariant,
    reply: FastifyReply,
    rangeHeader?: string
  ) {
    const creds = await requireImmichSettings();
    const path =
      variant === 'original' ? `/assets/${assetId}/original` : `/assets/${assetId}/thumbnail?size=${variant}`;
    // Override the default JSON Accept header — this response is binary image
    // data, not a JSON payload. The client's Range header must be forwarded:
    // native video players (iOS AVPlayer, Android ExoPlayer) stream mp4s via
    // byte-range requests and refuse to play when the server ignores them —
    // web <video> tolerates a full-body 200, so dropping Range only breaks
    // video on mobile.
    const headers: Record<string, string> = { Accept: '*/*' };
    if (rangeHeader) headers.Range = rangeHeader;
    const res = await immichFetch(path, creds, { headers });
    if (!res.body) throw new MediaProviderError('immich', 'unreachable');

    // Relay the status (206 for a satisfied Range) and range/caching headers
    // so a partial response stays partial for the player.
    reply.status(res.status);
    reply.header('content-type', res.headers.get('content-type') || 'application/octet-stream');
    for (const name of ['content-range', 'accept-ranges', 'cache-control']) {
      const value = res.headers.get(name);
      if (value) reply.header(name, value);
    }
    // fetch transparently decompresses encoded bodies — only relay a length
    // when it still describes the bytes actually being sent.
    if (!res.headers.get('content-encoding')) {
      const contentLength = res.headers.get('content-length');
      if (contentLength) reply.header('content-length', contentLength);
    }

    return reply.send(Readable.fromWeb(res.body as import('stream/web').ReadableStream));
  },
};
