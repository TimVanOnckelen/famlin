"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchApiTokens = fetchApiTokens;
exports.createApiToken = createApiToken;
exports.revokeApiToken = revokeApiToken;
const client_1 = require("./client");
async function fetchApiTokens() {
    const res = await client_1.api.get('/api-tokens');
    return res.data.items;
}
async function createApiToken(body) {
    const res = await client_1.api.post('/api-tokens', body);
    return res.data;
}
async function revokeApiToken(id) {
    await client_1.api.delete(`/api-tokens/${id}`);
}
