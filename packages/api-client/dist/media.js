"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupMediaAlbums = getGroupMediaAlbums;
exports.getGroupMediaPeople = getGroupMediaPeople;
exports.getMediaAlbumAssets = getMediaAlbumAssets;
const client_1 = require("./client");
async function getGroupMediaAlbums(groupId) {
    const response = await client_1.api.get(`/media/groups/${groupId}/albums`);
    return response.data;
}
async function getGroupMediaPeople(groupId) {
    const response = await client_1.api.get(`/media/people`, {
        params: { groupId },
    });
    return response.data;
}
async function getMediaAlbumAssets(linkId, personId) {
    const response = await client_1.api.get(`/media/albums/${linkId}/assets`, {
        params: personId ? { personId } : undefined,
    });
    return response.data;
}
