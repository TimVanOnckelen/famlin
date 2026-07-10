import type { FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { getImmichSettings } from '../settings.js';
import { MediaProviderError, type MediaProvider, type MediaAssetVariant, type MediaPersonSummary } from './types.js';

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
  if (!res.ok) {
    // The client only ever sees the generic translated message, so keep the
    // real status/body in the server log — it's the only way to tell a
    // validation 400 from an actual outage when debugging.
    const detail = await res.text().catch(() => '');
    console.warn(`Immich request failed: ${init?.method ?? 'GET'} ${path} -> ${res.status} ${detail.slice(0, 300)}`);
    throw new MediaProviderError('immich', 'unreachable');
  }
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
interface ImmichSearchAssetItem {
  id: string;
  type: string;
  width: number | null;
  height: number | null;
  // The Asset DB row's own creation timestamp (roughly "when Immich ingested
  // this file") — not present on every Immich server version's
  // AssetResponseDto, hence optional.
  createdAt?: string;
  // EXIF/file capture timestamp — always present, used as the addedAt
  // fallback when `createdAt` isn't returned (see listAlbumAssets below).
  fileCreatedAt?: string;
}

async function searchAlbumAssets(immichAlbumId: string) {
  const creds = await requireImmichSettings();
  const res = await immichFetch('/search/metadata', creds, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumIds: [immichAlbumId], size: 1000 }),
  });
  const data = (await res.json()) as { assets: { items: ImmichSearchAssetItem[] } };
  return data.assets.items;
}

const albumAssetIdsCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const ALBUM_ASSETS_CACHE_TTL_MS = 60 * 1000;

// Immich's GET /people is expected to return { people: PersonResponseDto[],
// total, hidden } on current server versions — handled defensively in case
// an older/newer server ever returns a bare array instead.
function extractPeopleList(data: unknown): Array<{ id: string; name?: string }> {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { people?: unknown }).people)) {
    return (data as { people: Array<{ id: string; name?: string }> }).people;
  }
  return [];
}

const MAX_PEOPLE = 100;
const MAX_THUMBNAIL_BYTES = 50 * 1024;

async function fetchPersonThumbnailDataUri(personId: string, creds: ImmichCreds): Promise<string | null> {
  try {
    const res = await immichFetch(`/people/${personId}/thumbnail`, creds, {
      headers: { Accept: '*/*' },
      allow404: true,
    });
    if (res.status === 404 || !res.body) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_THUMBNAIL_BYTES) return null;
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    // Any failure (network, non-2xx, oversized body) — the person is still
    // usable for mapping, just without a preview image.
    return null;
  }
}

// Caps how many /search/metadata pages getPersonAssetIds() will walk, so a
// person with a huge library can't turn one request into an unbounded crawl.
const PERSON_ASSET_ID_CAP = 5000;
const PERSON_ASSET_MAX_PAGES = 20;

export const immichProvider: MediaProvider = {
  id: 'immich',

  async isConfigured() {
    return (await getImmichSettings()).configured;
  },

  isValidAlbumId(externalAlbumId: string) {
    return IMMICH_ALBUM_ID_REGEX.test(externalAlbumId);
  },

  // For the admin's "link an album" picker. Immich's plain GET /albums only
  // returns albums the API key's owner created — shared-with-me albums need
  // the separate ?shared=true call. Merged and deduped by id, since an album
  // shared back to its own owner (or returned by both calls in some Immich
  // versions) would otherwise show up twice.
  async listAlbums() {
    const creds = await requireImmichSettings();
    const [ownedRes, sharedRes] = await Promise.all([
      immichFetch('/albums', creds),
      immichFetch('/albums?shared=true', creds),
    ]);
    const [owned, shared] = await Promise.all([
      ownedRes.json() as Promise<Array<{ id: string; albumName: string; assetCount: number }>>,
      sharedRes.json() as Promise<Array<{ id: string; albumName: string; assetCount: number }>>,
    ]);
    const byId = new Map<string, { id: string; name: string; assetCount: number }>();
    for (const a of [...owned, ...shared]) {
      byId.set(a.id, { id: a.id, name: a.albumName, assetCount: a.assetCount });
    }
    return [...byId.values()];
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
      // Prefer the Asset row's own `createdAt` (roughly "when Immich ingested
      // this file", i.e. actually added to the source) over `fileCreatedAt`
      // (the EXIF/file capture date) — the new-assets job cares about the
      // former. Not every Immich server version's AssetResponseDto includes
      // `createdAt` on this endpoint, so fall back to `fileCreatedAt` when
      // it's missing; that's still a reasonable proxy since a freshly
      // uploaded photo/video usually has a recent capture date too.
      addedAt: a.createdAt ?? a.fileCreatedAt ?? null,
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

  // Immich-only capability (see the optional methods on MediaProvider) — the
  // local provider has no face-recognition concept. Capped at 100 people:
  // this feeds an admin "map this person to a family member" picker, not a
  // paginated browse UI.
  async listPeople(): Promise<MediaPersonSummary[]> {
    const creds = await requireImmichSettings();
    const res = await immichFetch(`/people?size=${MAX_PEOPLE}`, creds);
    const data = await res.json();
    const people = extractPeopleList(data).slice(0, MAX_PEOPLE);

    return Promise.all(
      people.map(async (p) => ({
        id: p.id,
        name: p.name || '',
        thumbnailDataUri: await fetchPersonThumbnailDataUri(p.id, creds),
      }))
    );
  },

  // Collects every asset id Immich associates with a person, so a route can
  // intersect it with an album's asset ids to filter by person. Paginates via
  // /search/metadata's `nextPage` cursor, capped at PERSON_ASSET_ID_CAP total
  // ids / PERSON_ASSET_MAX_PAGES pages so a person with a huge library can't
  // turn one request into an unbounded crawl.
  async getPersonAssetIds(externalPersonId: string): Promise<Set<string>> {
    const creds = await requireImmichSettings();
    const ids = new Set<string>();
    let page: string | undefined;

    for (let i = 0; i < PERSON_ASSET_MAX_PAGES && ids.size < PERSON_ASSET_ID_CAP; i++) {
      // Immich returns `nextPage` as a string ("2") but validates `page` as
      // an integer — sending the string back gets a 400 on any person with
      // more than one page of assets.
      const body: Record<string, unknown> = { personIds: [externalPersonId], size: 1000 };
      if (page) body.page = Number(page);

      const res = await immichFetch('/search/metadata', creds, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { assets: { items: Array<{ id: string }>; nextPage?: string | null } };
      const items = data.assets?.items ?? [];
      for (const item of items) {
        ids.add(item.id);
        if (ids.size >= PERSON_ASSET_ID_CAP) break;
      }

      page = data.assets?.nextPage ?? undefined;
      if (!page || items.length === 0) break;
    }

    return ids;
  },
};
