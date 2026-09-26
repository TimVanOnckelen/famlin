"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchStoryTray = fetchStoryTray;
exports.fetchStoryHighlights = fetchStoryHighlights;
exports.fetchStory = fetchStory;
exports.createStory = createStory;
exports.markStoryViewed = markStoryViewed;
exports.fetchStoryViews = fetchStoryViews;
exports.reactToStory = reactToStory;
exports.fetchStoryReactions = fetchStoryReactions;
exports.replyToStory = replyToStory;
exports.fetchStoryReplies = fetchStoryReplies;
exports.pinStory = pinStory;
exports.unpinStory = unpinStory;
exports.deleteStory = deleteStory;
exports.isStoryLive = isStoryLive;
const client_1 = require("./client");
// Empty/undefined groupIds = every group you belong to (same semantics as
// the feed's group filter).
function groupParams(groupIds) {
    return groupIds && groupIds.length > 0 ? { groupIds: groupIds.join(',') } : {};
}
async function fetchStoryTray(groupIds) {
    const response = await client_1.api.get('/stories', { params: groupParams(groupIds) });
    return response.data;
}
async function fetchStoryHighlights(groupIds, cursor) {
    const response = await client_1.api.get('/stories/highlights', {
        params: { ...groupParams(groupIds), ...(cursor ? { cursor } : {}) },
    });
    return response.data;
}
async function fetchStory(id) {
    const response = await client_1.api.get(`/stories/${id}`);
    return response.data;
}
async function createStory(body) {
    const response = await client_1.api.post('/stories', body);
    return response.data;
}
async function markStoryViewed(id) {
    await client_1.api.post(`/stories/${id}/view`);
}
async function fetchStoryViews(id) {
    const response = await client_1.api.get(`/stories/${id}/views`);
    return response.data.items;
}
// Same reaction again removes it; a different one switches it.
async function reactToStory(id, type) {
    const response = await client_1.api.post(`/stories/${id}/reaction`, { type });
    return response.data;
}
async function fetchStoryReactions(id) {
    const response = await client_1.api.get(`/stories/${id}/reactions`);
    return response.data.items;
}
// One private reply per viewer, only while the story is live.
async function replyToStory(id, content) {
    const response = await client_1.api.post(`/stories/${id}/reply`, { content });
    return response.data;
}
async function fetchStoryReplies(id) {
    const response = await client_1.api.get(`/stories/${id}/replies`);
    return response.data.items;
}
async function pinStory(id) {
    const response = await client_1.api.post(`/stories/${id}/pin`);
    return response.data;
}
// On an expired Highlight this DELETES the story (`deleted: true`) — confirm
// with the user first.
async function unpinStory(id) {
    const response = await client_1.api.delete(`/stories/${id}/pin`);
    return response.data;
}
async function deleteStory(id) {
    await client_1.api.delete(`/stories/${id}`);
}
// Has this story's 24h window passed? Clients use it to drop a story from an
// open viewer/tray without waiting for a refetch.
function isStoryLive(story, now = new Date()) {
    return new Date(story.expiresAt).getTime() > now.getTime();
}
