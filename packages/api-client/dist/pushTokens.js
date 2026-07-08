"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPushToken = registerPushToken;
exports.unregisterPushToken = unregisterPushToken;
const client_1 = require("./client");
async function registerPushToken(token) {
    await client_1.api.post('/push-tokens', { token });
}
async function unregisterPushToken(token) {
    await client_1.api.delete('/push-tokens', { params: { token } });
}
