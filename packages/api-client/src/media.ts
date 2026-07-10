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
