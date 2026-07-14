"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPosts = fetchPosts;
exports.fetchPost = fetchPost;
exports.fetchOnThisDay = fetchOnThisDay;
exports.searchPosts = searchPosts;
exports.fetchFavorites = fetchFavorites;
exports.createPost = createPost;
exports.updatePost = updatePost;
exports.deletePost = deletePost;
exports.reactToPost = reactToPost;
exports.toggleFavoritePost = toggleFavoritePost;
exports.interactWithPost = interactWithPost;
exports.votePoll = votePoll;
const client_1 = require("./client");
async function fetchPosts(params = {}) {
    const response = await client_1.api.get('/posts', {
        params: {
            groupIds: params.groupIds && params.groupIds.length > 0 ? params.groupIds.join(',') : undefined,
            cursor: params.cursor,
        },
    });
    return response.data;
}
async function fetchPost(postId) {
    const response = await client_1.api.get(`/posts/${postId}`);
    return response.data;
}
async function fetchOnThisDay(groupId) {
    const response = await client_1.api.get('/posts/on-this-day', { params: { groupId } });
    return response.data.items;
}
async function searchPosts(params) {
    const response = await client_1.api.get('/posts/search', { params });
    return response.data;
}
async function fetchFavorites(cursor) {
    const response = await client_1.api.get('/favorites', { params: { cursor } });
    return response.data;
}
async function createPost(data) {
    const response = await client_1.api.post('/posts', data);
    return response.data;
}
async function updatePost(postId, content) {
    const response = await client_1.api.patch(`/posts/${postId}`, { content });
    return response.data;
}
async function deletePost(postId) {
    await client_1.api.delete(`/posts/${postId}`);
}
async function reactToPost(postId, type) {
    const response = await client_1.api.post(`/posts/${postId}/like`, { type });
    return response.data;
}
async function toggleFavoritePost(postId) {
    const response = await client_1.api.post(`/posts/${postId}/favorite`);
    return response.data;
}
// Generic per-post-type interaction endpoint (e.g. poll voting). Returns the
// full shaped + enriched post so callers can refresh their cache in one round
// trip — see votePoll() below for the poll-specific convenience wrapper.
async function interactWithPost(postId, key, value) {
    const response = await client_1.api.post(`/posts/${postId}/interactions`, { key, value });
    return response.data;
}
// Voting the same option again unvotes; voting a different option switches —
// mirrors reaction semantics. See PostTypeHandler.interact on the backend.
async function votePoll(postId, optionId) {
    return interactWithPost(postId, 'vote', { optionId });
}
