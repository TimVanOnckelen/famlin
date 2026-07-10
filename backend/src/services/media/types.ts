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
  // ISO 8601 timestamp of when the asset was added/uploaded to the source —
  // NOT when the photo/video was captured (fileCreatedAt/EXIF date). Powers
  // src/jobs/newAssets.ts's "what's new since I last checked" scan. null when
  // a provider can't report it.
  addedAt?: string | null;
}

// One person/face identity a provider can recognize within its library
// (e.g. an Immich "person"). Surfaced only by providers that implement
// listPeople(); used by the admin UI to map a person to a Famlin user
// (MediaPersonLink) and, from there, to filter an album's assets by person.
export interface MediaPersonSummary {
  id: string;
  name: string;
  // A small inline data: URI, or null if no thumbnail could be fetched.
  thumbnailDataUri: string | null;
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
  // Optional capabilities — not every provider can recognize people. Routes
  // must check for the method's presence and respond 400 (translated) rather
  // than assume every provider implements it (see admin.ts /media/:provider/people
  // and media.ts's ?personId= filter).
  listPeople?(): Promise<MediaPersonSummary[]>;
  // Person-centric: every asset id the provider associates with one person.
  // On Immich this only ever sees people recognized within the API key
  // owner's own library — a shared album's assets owned by another Immich
  // user never appear here, even though the asset itself is readable. Kept
  // as the fallback for providers that can't do the asset-centric query
  // below (or as a plain per-person crawl when that's all that's needed).
  getPersonAssetIds?(externalPersonId: string): Promise<Set<string>>;
  // Asset-centric, cross-owner: every tagged person on every asset in one
  // album, keyed by assetId. Exists because Immich person entities are
  // per-library — getPersonAssetIds()/listPeople() only see people the API
  // key's own account recognizes, so a shared album containing photos owned
  // by *other* Immich users never gets those people tagged or mappable.
  // AssetResponseDto.people is populated for any asset the caller can read
  // regardless of owner, so walking assets (this method) sees people
  // getPersonAssetIds() cannot. Implementations should cache the per-album
  // result briefly (remote crawl) — see immich.ts's getAlbumAssetPeople.
  getAlbumAssetPeople?(externalAlbumId: string): Promise<Map<string, Array<{ id: string; name: string }>>>;
  // One person's thumbnail outside the listPeople() catalog crawl — used to
  // backfill a preview image for a person discovered only via
  // getAlbumAssetPeople (i.e. not present in the key owner's own /people
  // list). null (not a throw) when the thumbnail can't be fetched (e.g. the
  // API key isn't authorized to read that person, a common cross-owner case).
  getPersonThumbnail?(externalPersonId: string): Promise<string | null>;
}
