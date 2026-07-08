"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchInvitePreview = fetchInvitePreview;
exports.registerViaInvite = registerViaInvite;
exports.acceptInvite = acceptInvite;
const client_1 = require("./client");
async function fetchInvitePreview(token) {
    const response = await client_1.api.get(`/invites/${token}`);
    return response.data;
}
async function registerViaInvite(token, data) {
    const response = await client_1.api.post(`/invites/${token}/register`, data);
    return response.data;
}
async function acceptInvite(token) {
    const response = await client_1.api.post(`/invites/${token}/accept`);
    return response.data;
}
