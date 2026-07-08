"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupImmichAlbums = getGroupImmichAlbums;
exports.getImmichAlbumAssets = getImmichAlbumAssets;
const client_1 = require("./client");
async function getGroupImmichAlbums(groupId) {
    const response = await client_1.api.get(`/immich/groups/${groupId}/albums`);
    return response.data;
}
async function getImmichAlbumAssets(linkId) {
    const response = await client_1.api.get(`/immich/albums/${linkId}/assets`);
    return response.data;
}
