"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGroups = fetchGroups;
exports.fetchGroupMembers = fetchGroupMembers;
const client_1 = require("./client");
async function fetchGroups() {
    const response = await client_1.api.get('/groups');
    return response.data;
}
async function fetchGroupMembers(groupId) {
    const response = await client_1.api.get(`/groups/${groupId}/members`);
    return response.data;
}
