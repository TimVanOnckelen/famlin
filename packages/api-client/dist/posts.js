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
exports.fetchPostReactions = fetchPostReactions;
exports.toggleFavoritePost = toggleFavoritePost;
exports.interactWithPost = interactWithPost;
exports.votePoll = votePoll;
exports.checkInTrip = checkInTrip;
exports.closeTrip = closeTrip;
exports.setTripTravelers = setTripTravelers;
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
// Every reactor and which emoji they left, newest first — used by the "who
// reacted with what" view, as opposed to Post.recentReactors (top 3, no type).
async function fetchPostReactions(postId) {
    const response = await client_1.api.get(`/posts/${postId}/reactions`);
    return response.data.items;
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
// Adds a check-in to an active trip. Allowed for the post author or any
// designated co-traveler (see setTripTravelers below); the server rejects
// anyone else (errors.tripNotTraveler) and closed trips (errors.tripClosed).
// Returns the full shaped + enriched post, same contract as votePoll — the
// check-in itself is persisted as a Comment with
// `metadata: { kind: 'trip_checkin', ... }` (see fetchComments), so callers
// should also refresh the post's comments after this resolves.
async function checkInTrip(postId, data) {
    return interactWithPost(postId, 'checkin', data);
}
// Closes a trip (author only, irreversible): flips `trip.closed`, and the
// timeline reverses to oldest-first client-side. Returns the full shaped +
// enriched post.
async function closeTrip(postId) {
    return interactWithPost(postId, 'close');
}
// Replaces the trip's co-traveler list (author only, active trips only) —
// userIds are group members, max 20, and must NOT include the author (who is
// implicitly a traveler). Server errors: errors.tripNotAuthor,
// errors.tripTravelerNotMember, errors.tripClosed. Returns the full shaped +
// enriched post (its trip.travelers reflecting the new list).
async function setTripTravelers(postId, userIds) {
    return interactWithPost(postId, 'setTravelers', { userIds });
}
