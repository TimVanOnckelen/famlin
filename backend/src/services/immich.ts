import type { FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { getImmichSettings } from './settings.js';

// Thrown for expected, user-facing Immich failures so routes can map them to
// a translated message instead of leaking fetch internals via err.message
// (same pattern as OidcError in plugins/auth.ts).
export class ImmichError extends Error {
  constructor(public code: 'not_configured' | 'unreachable' | 'unauthorized') {
    super(code);
    this.name = 'ImmichError';
  }
}

// Single source of truth for mapping an ImmichError to a translated key/HTTP
// status — every route that touches the Immich API (routes/immich.ts,
// routes/admin.ts) imports these instead of re-deriving the mapping, so a
// misconfigured or unreachable server always reports the same way regardless
// of which route hit it (mirrors OIDC_ERROR_KEY in routes/auth.ts).
export function immichErrorKey(err: ImmichError): string {
  return err.code === 'not_configured' ? 'errors.immichNotConfigured' : 'errors.immichUnreachable';
}

export function immichErrorStatus(err: ImmichError): number {
  return err.code === 'not_configured' ? 400 : 502;
}

interface ImmichCreds {
  serverUrl: string;
  apiKey: string;
}

async function requireImmichSettings(): Promise<ImmichCreds> {
  const { serverUrl, apiKey, configured } = await getImmichSettings();
  if (!configured) throw new ImmichError('not_configured');
  return { serverUrl, apiKey };
}

// `allow404` lets a caller (getImmichAlbumInfo) distinguish "album was
// deleted on the Immich side" from a real failure instead of it collapsing
// into the generic `unreachable` error below.
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
    throw new ImmichError('unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new ImmichError('unauthorized');
  if (init?.allow404 && res.status === 404) return res;
  if (!res.ok) throw new ImmichError('unreachable');
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
    return { ok: false, error: err instanceof ImmichError && err.code === 'unauthorized' ? 'unauthorized' : 'unreachable' };
  }
}

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
}

// For the admin's "link an album" picker.
export async function listImmichAlbums(): Promise<ImmichAlbumSummary[]> {
  const creds = await requireImmichSettings();
  const res = await immichFetch('/albums', creds);
  const albums = (await res.json()) as Array<{ id: string; albumName: string; assetCount: number }>;
  return albums.map((a) => ({ id: a.id, albumName: a.albumName, assetCount: a.assetCount }));
}

// For the member-facing album list (routes/immich.ts) — fetches just one
// album's metadata instead of listImmichAlbums()'s full-instance catalog, so
// looking up a group's linked album(s) doesn't scale with the size of the
// whole Immich library. Returns null (rather than throwing) if the album was
// deleted on the Immich side after being linked.
export async function getImmichAlbumInfo(immichAlbumId: string): Promise<{ assetCount: number } | null> {
  const creds = await requireImmichSettings();
  const res = await immichFetch(`/albums/${immichAlbumId}`, creds, { allow404: true });
  if (res.status === 404) return null;
  const data = (await res.json()) as { assetCount: number };
  return { assetCount: data.assetCount };
}

export interface ImmichAssetSummary {
  id: string;
  type: string;
  width: number | null;
  height: number | null;
}

// Immich's GET /albums/:id doesn't return the album's assets (AlbumResponseDto
// has no `assets` field) — the documented way to list them is a metadata
// search scoped to the album via POST /search/metadata. `size` is capped at
// Immich's own max page size; a single page is plenty for a family album, so
// pagination (`nextPage`) isn't followed here.
export async function getImmichAlbumAssets(immichAlbumId: string): Promise<ImmichAssetSummary[]> {
  const creds = await requireImmichSettings();
  const res = await immichFetch('/search/metadata', creds, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumIds: [immichAlbumId], size: 1000 }),
  });
  const data = (await res.json()) as {
    assets: { items: Array<{ id: string; type: string; width: number | null; height: number | null }> };
  };
  return data.assets.items.map((a) => ({
    id: a.id,
    type: a.type,
    width: a.width,
    height: a.height,
  }));
}

const albumAssetIdsCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const ALBUM_ASSETS_CACHE_TTL_MS = 60 * 1000;

// The asset proxy route (routes/immich.ts) re-checks that a requested asset
// id actually belongs to the linked album, not just that the linkId maps to
// a group the requester is a member of — otherwise the server-level API key
// would let any member read any asset on the whole Immich instance, including
// albums never linked to Famlin, once they learn an asset id from elsewhere
// (e.g. another group's post). Cached briefly and in-memory, matching the
// other short-lived single-instance caches in this codebase (getAllSettings,
// discoveryCache), so an image grid doesn't trigger one Immich search per
// tile.
export async function isAssetInAlbum(immichAlbumId: string, assetId: string): Promise<boolean> {
  const cached = albumAssetIdsCache.get(immichAlbumId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids.has(assetId);
  }

  const assets = await getImmichAlbumAssets(immichAlbumId);
  const ids = new Set(assets.map((a) => a.id));
  albumAssetIdsCache.set(immichAlbumId, { ids, expiresAt: Date.now() + ALBUM_ASSETS_CACHE_TTL_MS });
  return ids.has(assetId);
}

export type ImmichAssetVariant = 'thumbnail' | 'preview' | 'original';

// Streams a rendition straight from Immich into the response — mirrors how
// routes/uploads.ts serves local files, but proxied. `thumbnail` (small,
// grid-sized) and `preview` (larger — what Immich's own web viewer displays,
// well short of the original's file size) both hit the same endpoint with a
// different `size`; `original` is the true source file.
export async function proxyImmichAsset(
  assetId: string,
  variant: ImmichAssetVariant,
  reply: FastifyReply
): Promise<void> {
  const creds = await requireImmichSettings();
  const path =
    variant === 'original' ? `/assets/${assetId}/original` : `/assets/${assetId}/thumbnail?size=${variant}`;
  // Override the default JSON Accept header — this response is binary image
  // data, not a JSON payload.
  const res = await immichFetch(path, creds, { headers: { Accept: '*/*' } });
  if (!res.body) throw new ImmichError('unreachable');

  reply.header('content-type', res.headers.get('content-type') || 'application/octet-stream');
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl) reply.header('cache-control', cacheControl);

  return reply.send(Readable.fromWeb(res.body as import('stream/web').ReadableStream));
}
