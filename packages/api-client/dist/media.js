"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupMediaAlbums = getGroupMediaAlbums;
exports.getMediaAlbumAssets = getMediaAlbumAssets;
const client_1 = require("./client");
async function getGroupMediaAlbums(groupId) {
    const response = await client_1.api.get(`/media/groups/${groupId}/albums`);
    return response.data;
}
async function getMediaAlbumAssets(linkId) {
    const response = await client_1.api.get(`/media/albums/${linkId}/assets`);
    return response.data;
}
