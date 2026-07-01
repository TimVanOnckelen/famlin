import { config } from '../config.js';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  originalPath: string;
  originalFileName: string;
  resizePath: string | null;
  webpPath: string | null;
  encodedVideoPath: string | null;
  createdAt: string;
  exifInfo?: {
    description?: string;
  } | null;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  description: string;
  albumThumbnailAssetId: string | null;
  shared: boolean;
  assets: ImmichAsset[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchFromImmich(path: string) {
  if (!config.IMMICH_BASE_URL || !config.IMMICH_API_KEY) {
    throw new Error('Immich not configured');
  }

  const cacheKey = path;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = new URL(path, config.IMMICH_BASE_URL).toString();
  const response = await fetch(url, {
    headers: {
      'x-api-key': config.IMMICH_API_KEY,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Immich API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });

  return data;
}

export async function getAlbum(albumId: string): Promise<ImmichAlbum> {
  return fetchFromImmich(`/api/albums/${albumId}`);
}

export async function getSharedAlbums(): Promise<ImmichAlbum[]> {
  return fetchFromImmich('/api/albums?shared=true');
}

export async function getAsset(assetId: string): Promise<ImmichAsset> {
  return fetchFromImmich(`/api/assets/${assetId}`);
}

export function getAssetUrl(assetId: string, type: 'thumbnail' | 'original' | 'webp' = 'original') {
  if (!config.IMMICH_BASE_URL) {
    throw new Error('Immich not configured');
  }

  const path = type === 'thumbnail'
    ? `/api/assets/${assetId}/thumbnail`
    : type === 'webp'
      ? `/api/assets/${assetId}/webp`
      : `/api/assets/${assetId}/original`;

  return new URL(path, config.IMMICH_BASE_URL).toString();
}

export async function proxyAsset(assetId: string, type: 'thumbnail' | 'original' | 'webp' = 'original') {
  if (!config.IMMICH_BASE_URL || !config.IMMICH_API_KEY) {
    throw new Error('Immich not configured');
  }

  const path = type === 'thumbnail'
    ? `/api/assets/${assetId}/thumbnail`
    : type === 'webp'
      ? `/api/assets/${assetId}/webp`
      : `/api/assets/${assetId}/original`;

  const url = new URL(path, config.IMMICH_BASE_URL).toString();
  const response = await fetch(url, {
    headers: {
      'x-api-key': config.IMMICH_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Immich asset error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());

  return { buffer, contentType };
}

export function clearImmichCache() {
  cache.clear();
}
