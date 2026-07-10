"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOidcConfig = fetchOidcConfig;
exports.loginWithOidc = loginWithOidc;
exports.exchangeOidcMobileHandoff = exchangeOidcMobileHandoff;
exports.exchangeOidcCode = exchangeOidcCode;
exports.loginWithPassword = loginWithPassword;
exports.fetchMe = fetchMe;
exports.updateMe = updateMe;
exports.fetchNotificationConfig = fetchNotificationConfig;
exports.fetchServerInfo = fetchServerInfo;
exports.changePassword = changePassword;
const client_1 = require("./client");
async function fetchOidcConfig() {
    const response = await client_1.api.get('/auth/oidc-config');
    return response.data;
}
async function loginWithOidc(idToken, inviteToken) {
    const response = await client_1.api.post('/auth/oidc', { idToken, inviteToken });
    return response.data;
}
async function exchangeOidcMobileHandoff(code) {
    const response = await client_1.api.post('/auth/oidc/mobile-handoff', { code });
    return response.data;
}
// Server-mediated code exchange for providers that require a client secret
// (e.g. Google) — the backend holds the secret and does the exchange. Used
// by browser surfaces (admin/web) after an Authorization Code + PKCE
// redirect; mobile uses the mobile-callback/mobile-handoff pair instead.
async function exchangeOidcCode(code, redirectUri, codeVerifier, inviteToken) {
    const response = await client_1.api.post('/auth/oidc/exchange', {
        code,
        redirectUri,
        codeVerifier,
        inviteToken,
    });
    return response.data;
}
async function loginWithPassword(email, password, inviteToken) {
    const response = await client_1.api.post('/auth/login', { email, password, inviteToken });
    return response.data;
}
async function fetchMe() {
    const response = await client_1.api.get('/auth/me');
    return response.data;
}
async function updateMe(data) {
    const response = await client_1.api.patch('/auth/me', data);
    return response.data;
}
async function fetchNotificationConfig() {
    const response = await client_1.api.get('/auth/notification-config');
    return response.data;
}
async function fetchServerInfo() {
    const response = await client_1.api.get('/auth/server-info');
    return response.data;
}
async function changePassword(currentPassword, newPassword) {
    await client_1.api.post('/auth/change-password', { currentPassword, newPassword });
}
