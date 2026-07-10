import type { FastifyReply } from 'fastify';

// Thrown for expected, user-facing media-source failures so routes can map
// them to a translated message instead of leaking fetch/fs internals via
// err.message (same pattern as OidcError in plugins/auth.ts). Map to a
// message/status with mediaErrorKey()/mediaErrorStatus() in registry.ts.
export class MediaProviderError extends Error {
  constructor(
    public provider: string,
    public code: 'not_configured' | 'unreachable' | 'unauthorized'
  ) {
    super(`${provider}: ${code}`);
    this.name = 'MediaProviderError';
  }
}

export type MediaAssetVariant = 'thumbnail' | 'preview' | 'original';

export interface MediaAlbumSummary {
  id: string;
  name: string;
  assetCount: number;
}

export interface MediaAssetSummary {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  width: number | null;
  height: number | null;
  // The extension the `original` variant streams for this asset (e.g. 'jpg',
  // 'mp4') — must stay within what MEDIA_ASSET_PATH_REGEX (src/types.ts)
  // accepts, since it's embedded in the URLs handed to clients.
  originalExt: string;
}

// A source of external photos/videos that groups can link albums from —
// Immich today, a local folder, and whatever comes next. One file per
// provider in this directory, registered in ./registry.ts.
//
// Contract notes:
// - Album ids and asset ids are provider-defined but must be URL-safe
//   ([A-Za-z0-9_-]) for asset ids, since they're embedded in proxy URLs.
// - isAssetInAlbum() is a security check, not an optimization: the album
//   link is the authorization boundary, so every asset request re-verifies
//   the asset actually belongs to the linked album (a provider-level
//   credential could otherwise read anything on the source). Cache briefly
//   if the lookup is remote.
// - streamAsset() must honor the Range header for video originals — native
//   players (iOS AVPlayer, Android ExoPlayer) refuse to play mp4s without
//   206/Content-Range support.
export interface MediaProvider {
  id: string;
  // Whether the server-level settings for this source are filled in — used
  // by the admin UI to show configuration state; routes surface
  // MediaProviderError('not_configured') instead of calling this.
  isConfigured(): Promise<boolean>;
  // Syntactic validity of an album id for this provider (an Immich uuid, a
  // safe folder name) — checked before an admin links one, so a crafted id
  // can never reach the filesystem/remote API.
  isValidAlbumId(externalAlbumId: string): boolean;
  // Full album catalog, for the admin "link an album" picker.
  listAlbums(): Promise<MediaAlbumSummary[]>;
  // One album's metadata — null if it no longer exists provider-side.
  getAlbumInfo(externalAlbumId: string): Promise<{ assetCount: number } | null>;
  listAlbumAssets(externalAlbumId: string): Promise<MediaAssetSummary[]>;
  isAssetInAlbum(externalAlbumId: string, assetId: string): Promise<boolean>;
  streamAsset(
    externalAlbumId: string,
    assetId: string,
    variant: MediaAssetVariant,
    reply: FastifyReply,
    rangeHeader?: string
  ): Promise<void>;
}
