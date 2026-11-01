"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMyGiftLists = fetchMyGiftLists;
exports.fetchGiftListItems = fetchGiftListItems;
exports.createGiftListItem = createGiftListItem;
exports.updateGiftListItem = updateGiftListItem;
exports.deleteGiftListItem = deleteGiftListItem;
exports.reorderGiftListItems = reorderGiftListItems;
exports.updateGiftListSettings = updateGiftListSettings;
exports.setGiftListParticipants = setGiftListParticipants;
exports.drawGiftList = drawGiftList;
exports.leaveGiftList = leaveGiftList;
exports.isGiftDrawResetConflict = isGiftDrawResetConflict;
const client_1 = require("./client");
// Gift lists (issue #307). The post itself is created/read/deleted through the
// ordinary posts endpoints (type 'GIFT_LIST'); these cover the wishlists,
// participants, settings and the Secret Santa draw. Every endpoint 404s for
// anyone who isn't a participant.
// Every gift list you take part in, across your families, newest occasion first.
async function fetchMyGiftLists() {
    const response = await client_1.api.get('/gift-lists');
    return response.data.items;
}
async function fetchGiftListItems(postId) {
    const response = await client_1.api.get(`/gift-lists/${postId}/items`);
    return response.data.items;
}
async function createGiftListItem(postId, body) {
    const response = await client_1.api.post(`/gift-lists/${postId}/items`, body);
    return response.data;
}
async function updateGiftListItem(postId, itemId, body) {
    const response = await client_1.api.patch(`/gift-lists/${postId}/items/${itemId}`, body);
    return response.data;
}
async function deleteGiftListItem(postId, itemId) {
    await client_1.api.delete(`/gift-lists/${postId}/items/${itemId}`);
}
// `itemIds` must be every one of your own wishes, in the new order.
async function reorderGiftListItems(postId, itemIds) {
    const response = await client_1.api.put(`/gift-lists/${postId}/items/order`, { itemIds });
    return response.data.items;
}
// Starter only.
async function updateGiftListSettings(postId, body) {
    const response = await client_1.api.patch(`/gift-lists/${postId}`, body);
    return response.data;
}
// Starter only. `userIds` = everyone besides the starter.
async function setGiftListParticipants(postId, userIds, confirmRedraw = false) {
    const response = await client_1.api.put(`/gift-lists/${postId}/participants`, { userIds, confirmRedraw });
    return response.data;
}
// Starter only, once.
async function drawGiftList(postId) {
    const response = await client_1.api.post(`/gift-lists/${postId}/draw`);
    return response.data;
}
// Anyone but the starter.
async function leaveGiftList(postId) {
    await client_1.api.delete(`/gift-lists/${postId}/participants/me`);
}
// A 409 from settings/participants means "this would discard the draw" —
// clients ask for confirmation, then resend with confirmRedraw.
function isGiftDrawResetConflict(err) {
    return err?.response?.status === 409;
}
