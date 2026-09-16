"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMyCircles = fetchMyCircles;
exports.fetchCircleMembers = fetchCircleMembers;
exports.leaveCircle = leaveCircle;
const client_1 = require("./client");
// Member-facing Circle calls. Circles are FULLY PRIVATE: the server only
// ever returns the circles the caller is actually in, so there is no "list
// all circles in this group" call here by design — a group member outside a
// circle must not learn it exists. Creating, editing and deleting circles,
// and managing their membership, are admin operations exposed only through
// the admin UI.
async function fetchMyCircles(groupId) {
    const response = await client_1.api.get('/circles', { params: { groupId } });
    return response.data.items;
}
async function fetchCircleMembers(circleId) {
    const response = await client_1.api.get(`/circles/${circleId}/members`);
    return response.data.items;
}
// Leaving a circle never removes you from the family group behind it —
// you simply stop seeing that circle's content. Rejoining requires an admin.
async function leaveCircle(circleId) {
    await client_1.api.delete(`/circles/${circleId}/members/me`);
}
