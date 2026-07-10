export interface MediaGroupAlbum {
    linkId: string;
    provider: string;
    albumName: string;
    assetCount: number;
}
export interface MediaAsset {
    assetId: string;
    type: string;
    width: number | null;
    height: number | null;
    thumbnailUrl: string;
    previewUrl: string;
    originalUrl: string;
}
export declare function getGroupMediaAlbums(groupId: string): Promise<MediaGroupAlbum[]>;
export declare function getMediaAlbumAssets(linkId: string): Promise<MediaAsset[]>;
