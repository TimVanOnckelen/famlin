"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroupMediaAlbums = getGroupMediaAlbums;
exports.getGroupMediaPeople = getGroupMediaPeople;
exports.getMediaAlbumAssets = getMediaAlbumAssets;
exports.getGroupPhotoTimeline = getGroupPhotoTimeline;
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
async function getGroupPhotoTimeline(groupId, opts) {
    const response = await client_1.api.get(`/media/groups/${groupId}/photos`, {
        params: opts ? { cursor: opts.cursor, take: opts.take, personId: opts.personId } : undefined,
    });
    return response.data;
}
