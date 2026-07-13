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
  // Only populated when the search request sets `withPeople: true` (see
  // getAlbumAssetPeople below) — omitted from the type by default so the
  // plain listAlbumAssets()/isAssetInAlbum() searches don't imply it's there.
  people?: Array<{ id: string; name?: string }>;
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

interface ImmichPersonRef {
  id: string;
  name: string;
}

// getAlbumAssetPeople's per-album result, cached the same way
// albumAssetIdsCache above caches isAssetInAlbum — a feed/admin page that
// touches the same album repeatedly (many posts, many people) shouldn't
// re-crawl Immich per request. 10 minutes (not the 60s of the isAssetInAlbum
// cache) because this is a much heavier crawl (bulk search + a possible
// per-asset fallback pass) and staleness here only means a newly-tagged
// person takes a few minutes to show up, not a security question.
const ALBUM_PEOPLE_CACHE_TTL_MS = 10 * 60 * 1000;
const albumAssetPeopleCache = new Map<string, { data: Map<string, ImmichPersonRef[]>; expiresAt: number }>();

// Safety caps mirroring PERSON_ASSET_MAX_PAGES/PERSON_ASSET_ID_CAP above, plus
// a cap + concurrency limit on the individual-asset fallback pass so a large,
// mostly-other-owned shared album can't turn one request into hundreds of
// serial Immich round-trips.
const ALBUM_PEOPLE_MAX_PAGES = 20;
const ALBUM_PEOPLE_FALLBACK_MAX_ASSETS = 500;
const ALBUM_PEOPLE_FALLBACK_CONCURRENCY = 5;

// Bulk pass: POST /search/metadata scoped to the album with withPeople:true,
// paginated like getPersonAssetIds(). This is the fast path and covers most
// assets, but Immich's search may still scope results to the API key owner's
// own library even with albumIds set — see getAlbumAssetPeopleUncached's
// coverage check below for the cross-owner fallback.
async function fetchAlbumAssetPeopleBulk(
  externalAlbumId: string,
  creds: ImmichCreds
): Promise<Map<string, ImmichPersonRef[]>> {
  const result = new Map<string, ImmichPersonRef[]>();
  let page: string | undefined;

  for (let i = 0; i < ALBUM_PEOPLE_MAX_PAGES; i++) {
    // Same string->number `page` coercion pitfall as getPersonAssetIds:
    // Immich returns `nextPage` as a string but 400s if it's sent back as one.
    const body: Record<string, unknown> = { albumIds: [externalAlbumId], withPeople: true, size: 1000 };
    if (page) body.page = Number(page);

    const res = await immichFetch('/search/metadata', creds, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { assets: { items: ImmichSearchAssetItem[]; nextPage?: string | null } };
    const items = data.assets?.items ?? [];
    for (const item of items) {
      result.set(item.id, (item.people ?? []).map((p) => ({ id: p.id, name: p.name || '' })));
    }

    page = data.assets?.nextPage ?? undefined;
    if (!page || items.length === 0) break;
  }

  return result;
}

// Fallback pass: fetches each asset individually via GET /assets/:id (whose
// AssetResponseDto includes `people` regardless of the asset's owner) for
// whichever album assets the bulk search didn't return at all. Individual
// failures are tolerated — one inaccessible/deleted asset shouldn't blank out
// the rest of the album's people — and only warned once per album, not once
// per asset, so a systemically-failing album doesn't spam the log.
async function fetchAlbumAssetPeopleFallback(
  externalAlbumId: string,
  assetIds: string[],
  creds: ImmichCreds
): Promise<Map<string, ImmichPersonRef[]>> {
  const result = new Map<string, ImmichPersonRef[]>();
  const capped = assetIds.slice(0, ALBUM_PEOPLE_FALLBACK_MAX_ASSETS);
  let warned = false;

  for (let i = 0; i < capped.length; i += ALBUM_PEOPLE_FALLBACK_CONCURRENCY) {
    const chunk = capped.slice(i, i + ALBUM_PEOPLE_FALLBACK_CONCURRENCY);
    await Promise.all(
      chunk.map(async (assetId) => {
        try {
          const res = await immichFetch(`/assets/${assetId}`, creds, { allow404: true });
          if (res.status === 404) return;
          const data = (await res.json()) as { people?: Array<{ id: string; name?: string }> };
          result.set(assetId, (data.people ?? []).map((p) => ({ id: p.id, name: p.name || '' })));
        } catch (err) {
          if (!warned) {
            console.warn(`immich: getAlbumAssetPeople fallback failed for album ${externalAlbumId}:`, err);
            warned = true;
          }
        }
      })
    );
  }

  return result;
}

async function getAlbumAssetPeopleUncached(externalAlbumId: string): Promise<Map<string, ImmichPersonRef[]>> {
  const creds = await requireImmichSettings();
  const bulk = await fetchAlbumAssetPeopleBulk(externalAlbumId, creds);

  // Coverage check: compare against the album's actual asset list (the same
  // /search/metadata call listAlbumAssets() makes, minus withPeople) — any
  // asset genuinely missing from the bulk result (not just "returned with no
  // people") is assumed to belong to another Immich user and out of scope for
  // the album-search endpoint, so it gets fetched individually instead.
  const albumAssets = await searchAlbumAssets(externalAlbumId);
  const missingIds = albumAssets.map((a) => a.id).filter((id) => !bulk.has(id));

  if (missingIds.length > 0) {
    const fallback = await fetchAlbumAssetPeopleFallback(externalAlbumId, missingIds, creds);
    for (const [assetId, people] of fallback) bulk.set(assetId, people);
  }

  return bulk;
}

// Shared by streamAsset() and readAsset() below — the actual GET against
// Immich for one asset rendition. `rangeHeader` is only ever set by
// streamAsset (native video players need 206/Content-Range, see its own
// comment); readAsset always fetches the whole body since it's writing a
// complete file to disk, not serving a player incrementally.
async function fetchAssetFromImmich(
  assetId: string,
  variant: MediaAssetVariant,
  rangeHeader?: string
): Promise<Response> {
  const creds = await requireImmichSettings();
  const path = variant === 'original' ? `/assets/${assetId}/original` : `/assets/${assetId}/thumbnail?size=${variant}`;
  // Override the default JSON Accept header — this response is binary image
  // data, not a JSON payload.
  const headers: Record<string, string> = { Accept: '*/*' };
  if (rangeHeader) headers.Range = rangeHeader;
  const res = await immichFetch(path, creds, { headers });
  if (!res.body) throw new MediaProviderError('immich', 'unreachable');
  return res;
}

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
      // The EXIF/file capture date, always present on Immich's response —
      // what the photo timeline orders by (see MediaAssetSummary.takenAt).
      takenAt: a.fileCreatedAt ?? null,
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
    const res = await fetchAssetFromImmich(assetId, variant, rangeHeader);

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

  // Same bytes as streamAsset(), minus the reply/Range plumbing — see the
  // MediaProvider.readAsset doc comment for why this exists (copyAsset.ts).
  async readAsset(_externalAlbumId: string, assetId: string, variant: MediaAssetVariant) {
    const res = await fetchAssetFromImmich(assetId, variant);
    return {
      stream: Readable.fromWeb(res.body as import('stream/web').ReadableStream),
      contentType: res.headers.get('content-type') || undefined,
    };
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

  // Asset-centric, cross-owner alternative to getPersonAssetIds() — see the
  // doc comment on MediaProvider.getAlbumAssetPeople for why this exists.
  // Cached per album (ALBUM_PEOPLE_CACHE_TTL_MS) since a full crawl (bulk
  // search + a possible per-asset fallback pass) is too expensive to repeat
  // per request on a feed page with many posts.
  async getAlbumAssetPeople(externalAlbumId: string): Promise<Map<string, ImmichPersonRef[]>> {
    const cached = albumAssetPeopleCache.get(externalAlbumId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const data = await getAlbumAssetPeopleUncached(externalAlbumId);
    albumAssetPeopleCache.set(externalAlbumId, { data, expiresAt: Date.now() + ALBUM_PEOPLE_CACHE_TTL_MS });
    return data;
  },

  // Backfills a thumbnail for a person discovered only through
  // getAlbumAssetPeople (i.e. not in the API key owner's own listPeople()
  // catalog) — same endpoint/helper listPeople() uses for its own people.
  async getPersonThumbnail(externalPersonId: string): Promise<string | null> {
    const creds = await requireImmichSettings();
    return fetchPersonThumbnailDataUri(externalPersonId, creds);
  },
};
