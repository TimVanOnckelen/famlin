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
    thumbnailUrl: string;
    previewUrl: string;
    originalUrl: string;
}
export declare function getGroupImmichAlbums(groupId: string): Promise<ImmichGroupAlbum[]>;
export declare function getImmichAlbumAssets(linkId: string): Promise<ImmichAsset[]>;
