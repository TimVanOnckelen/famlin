import { api } from './client';

export interface ImmichAlbum {
  id: string;
  name: string;
  description: string;
  thumbnailAssetId: string | null;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImmichAlbumDetail extends ImmichAlbum {
  assets: ImmichAsset[];
}

export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  fileName: string;
  createdAt: string;
  description: string | null;
}

export async function fetchImmichAlbums(): Promise<ImmichAlbum[]> {
  const response = await api.get<ImmichAlbum[]>('/immich/albums');
  return response.data;
}

export async function fetchImmichAlbum(albumId: string): Promise<ImmichAlbumDetail> {
  const response = await api.get<ImmichAlbumDetail>(`/immich/albums/${albumId}`);
  return response.data;
}

export function getImmichAssetUrl(assetId: string, type: 'thumbnail' | 'original' | 'webp' = 'original'): string {
  return `${api.defaults.baseURL}/immich/assets/${assetId}/${type}`;
}
