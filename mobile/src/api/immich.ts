import { api } from './client';

export interface ImmichGroupAlbum {
  linkId: string;
  albumName: string;
  assetCount: number;
}

export interface ImmichAsset {
  assetId: string;
  type: string;
  width: number | null;
  height: number | null;
  // Small, grid-sized rendition — only for the picker's thumbnail grid.
  thumbnailUrl: string;
  // Larger rendition (Immich's own "preview" size) — what actually gets
  // attached to a post, since thumbnailUrl is too low-res to post.
  previewUrl: string;
  originalUrl: string;
}

export async function getGroupImmichAlbums(groupId: string): Promise<ImmichGroupAlbum[]> {
  const response = await api.get<ImmichGroupAlbum[]>(`/immich/groups/${groupId}/albums`);
  return response.data;
}

export async function getImmichAlbumAssets(linkId: string): Promise<ImmichAsset[]> {
  const response = await api.get<ImmichAsset[]>(`/immich/albums/${linkId}/assets`);
  return response.data;
}
