import { api } from './client';

// Provider-generic media endpoints (/api/media/*) — a group's linked albums
// can live on any configured media source (Immich, a local folder on the
// server, ...); `provider` says which. Supersedes the Immich-only functions
// in ./immich.ts, which remain for the legacy /api/immich/* surface.

export interface MediaGroupAlbum {
  linkId: string;
  // Registry id of the media source this album lives on ('immich', 'local').
  provider: string;
  albumName: string;
  assetCount: number;
}

export interface MediaAsset {
  assetId: string;
  type: string;
  width: number | null;
  height: number | null;
  // Small, grid-sized rendition — only for the picker's thumbnail grid.
  thumbnailUrl: string;
  // Larger rendition — what actually gets attached to a post, since
  // thumbnailUrl is too low-res to post.
  previewUrl: string;
  originalUrl: string;
}

export interface MediaPerson {
  id: string;
  // Registry id of the media source this person lives on ('immich', 'local').
  provider: string;
  label: string;
  // The user id if this person is mapped to a Famlin account, null otherwise.
  userId: string | null;
}

export interface PhotoItem {
  id: string;
  source: 'album' | 'post';
  type: 'IMAGE' | 'VIDEO';
  takenAt: string; // ISO 8601 timestamp
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

export interface PhotoTimelinePage {
  items: PhotoItem[];
  nextCursor: string | null;
}

export async function getGroupMediaAlbums(groupId: string): Promise<MediaGroupAlbum[]> {
  const response = await api.get<MediaGroupAlbum[]>(`/media/groups/${groupId}/albums`);
  return response.data;
}

export async function getGroupMediaPeople(groupId: string): Promise<MediaPerson[]> {
  const response = await api.get<MediaPerson[]>(`/media/people`, {
    params: { groupId },
  });
  return response.data;
}

export async function getMediaAlbumAssets(
  linkId: string,
  personId?: string
): Promise<MediaAsset[]> {
  const response = await api.get<MediaAsset[]>(`/media/albums/${linkId}/assets`, {
    params: personId ? { personId } : undefined,
  });
  return response.data;
}

export async function getGroupPhotoTimeline(
  groupId: string,
  opts?: { cursor?: string; take?: number; personId?: string }
): Promise<PhotoTimelinePage> {
  const response = await api.get<PhotoTimelinePage>(`/media/groups/${groupId}/photos`, {
    params: opts ? { cursor: opts.cursor, take: opts.take, personId: opts.personId } : undefined,
  });
  return response.data;
}
