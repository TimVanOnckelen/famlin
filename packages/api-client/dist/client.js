"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
exports.setApiBaseUrl = setApiBaseUrl;
exports.getCurrentServerUrl = getCurrentServerUrl;
exports.setMediaToken = setMediaToken;
exports.getCurrentMediaToken = getCurrentMediaToken;
exports.initApiBaseUrl = initApiBaseUrl;
exports.setUnauthorizedHandler = setUnauthorizedHandler;
const tslib_1 = require("tslib");
const axios_1 = tslib_1.__importDefault(require("axios"));
const storage_1 = require("./storage");
// The base URL comes from initApiBaseUrl() (stored server) or
// setApiBaseUrl() (login/invite flow) — there is deliberately no hardcoded
// localhost fallback here: silently targeting localhost when neither of
// those has run yet would mask real failures instead of surfacing them.
let currentServerUrl = null;
let currentBaseUrl = null;
function setApiBaseUrl(serverUrl) {
    const normalized = serverUrl.trim().replace(/\/+$/, '');
    currentServerUrl = normalized;
    currentBaseUrl = `${normalized}/api`;
}
function getCurrentServerUrl() {
    return currentServerUrl;
}
// A short-lived, narrow-scope token (separate from the main session token)
// used only to authorize GETs under /uploads — cached in memory so
// getUploadUrl() can stay synchronous for use directly in <Image>/<Video>
// source props. See uploads.ts and the backend's onRequest hook in app.ts.
let currentMediaToken = null;
function setMediaToken(token) {
    currentMediaToken = token;
}
function getCurrentMediaToken() {
    return currentMediaToken;
}
async function initApiBaseUrl() {
    const stored = await (0, storage_1.getStorageAdapter)().getItem(storage_1.SERVER_URL_KEY);
    if (stored) {
        setApiBaseUrl(stored);
    }
}
exports.api = axios_1.default.create({
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});
exports.api.interceptors.request.use(async (config) => {
    // If neither initApiBaseUrl() nor setApiBaseUrl() has run yet, leave
    // baseURL unset so the request fails fast instead of silently hitting a
    // hardcoded default.
    config.baseURL = currentBaseUrl ?? undefined;
    const token = await (0, storage_1.getStorageAdapter)().getItem(storage_1.TOKEN_KEY);
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});
// Lets a consumer's auth store react to a 401 (expired/revoked session)
// without this module importing that store directly, which would create a
// circular import (the store already imports setApiBaseUrl from here).
let unauthorizedHandler = null;
function setUnauthorizedHandler(fn) {
    unauthorizedHandler = fn;
}
exports.api.interceptors.response.use((response) => response, async (error) => {
    if (error.response?.status === 401) {
        await (0, storage_1.getStorageAdapter)().removeItem(storage_1.TOKEN_KEY);
        unauthorizedHandler?.();
    }
    return Promise.reject(error);
});
