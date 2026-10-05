"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOidcConfig = fetchOidcConfig;
exports.loginWithOidc = loginWithOidc;
exports.loginWithApple = loginWithApple;
exports.exchangeOidcMobileHandoff = exchangeOidcMobileHandoff;
exports.exchangeOidcCode = exchangeOidcCode;
exports.loginWithPassword = loginWithPassword;
exports.fetchMe = fetchMe;
exports.updateMe = updateMe;
exports.fetchNotificationConfig = fetchNotificationConfig;
exports.fetchServerInfo = fetchServerInfo;
exports.deleteAccount = deleteAccount;
exports.downloadMyExport = downloadMyExport;
exports.getMyExportRequest = getMyExportRequest;
exports.changePassword = changePassword;
const client_1 = require("./client");
const storage_1 = require("./storage");
async function fetchOidcConfig() {
    const response = await client_1.api.get('/auth/oidc-config');
    return response.data;
}
async function loginWithOidc(idToken, inviteToken) {
    const response = await client_1.api.post('/auth/oidc', { idToken, inviteToken });
    return response.data;
}
// Sign in with Apple. `fullName` is only available on the user's very first
// authorization for this app — Apple never discloses it again, so pass it
// through when present and omit it otherwise (the server keeps the name
// already on file).
async function loginWithApple(identityToken, fullName, inviteToken) {
    const response = await client_1.api.post('/auth/apple', { identityToken, fullName, inviteToken });
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
// Permanently deletes the logged-in user's own account and everything it
// cascades to (posts, comments, reactions, favorites, chat messages,
// notifications). There is no restore — callers must confirm first.
async function deleteAccount() {
    await client_1.api.delete('/auth/me');
}
// Self-service data export (GET /api/auth/me/export): a zip of everything
// the caller can see in their groups — other members' posts included — plus
// the photos/videos it references. Can be large, so no request timeout.
// Browser callers (web) take the Blob and save it; mobile streams straight
// to disk instead via getMyExportRequest(), since holding a whole family's
// media in JS memory would not survive on a phone.
async function downloadMyExport() {
    const response = await client_1.api.get('/auth/me/export', { responseType: 'blob', timeout: 0 });
    return response.data;
}
// The absolute URL + auth header for the export, for a native downloader
// that writes to a file rather than going through axios.
async function getMyExportRequest() {
    const serverUrl = (0, client_1.getCurrentServerUrl)();
    if (!serverUrl)
        throw new Error('No server URL configured');
    const token = await (0, storage_1.getStorageAdapter)().getItem(storage_1.TOKEN_KEY);
    return {
        url: `${serverUrl}/api/auth/me/export`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
}
async function changePassword(currentPassword, newPassword) {
    await client_1.api.post('/auth/change-password', { currentPassword, newPassword });
}
