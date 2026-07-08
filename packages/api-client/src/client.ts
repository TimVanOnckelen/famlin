import axios from 'axios';
import { getStorageAdapter, TOKEN_KEY, SERVER_URL_KEY } from './storage';

// The base URL comes from initApiBaseUrl() (stored server) or
// setApiBaseUrl() (login/invite flow) — there is deliberately no hardcoded
// localhost fallback here: silently targeting localhost when neither of
// those has run yet would mask real failures instead of surfacing them.
let currentServerUrl: string | null = null;
let currentBaseUrl: string | null = null;

export function setApiBaseUrl(serverUrl: string) {
  const normalized = serverUrl.trim().replace(/\/+$/, '');
  currentServerUrl = normalized;
  currentBaseUrl = `${normalized}/api`;
}

export function getCurrentServerUrl(): string | null {
  return currentServerUrl;
}

// A short-lived, narrow-scope token (separate from the main session token)
// used only to authorize GETs under /uploads — cached in memory so
// getUploadUrl() can stay synchronous for use directly in <Image>/<Video>
// source props. See uploads.ts and the backend's onRequest hook in app.ts.
let currentMediaToken: string | null = null;

export function setMediaToken(token: string | null) {
  currentMediaToken = token;
}

export function getCurrentMediaToken(): string | null {
  return currentMediaToken;
}

export async function initApiBaseUrl() {
  const stored = await getStorageAdapter().getItem(SERVER_URL_KEY);
  if (stored) {
    setApiBaseUrl(stored);
  }
}

export const api = axios.create({
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config) => {
  // If neither initApiBaseUrl() nor setApiBaseUrl() has run yet, leave
  // baseURL unset so the request fails fast instead of silently hitting a
  // hardcoded default.
  config.baseURL = currentBaseUrl ?? undefined;
  const token = await getStorageAdapter().getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Lets a consumer's auth store react to a 401 (expired/revoked session)
// without this module importing that store directly, which would create a
// circular import (the store already imports setApiBaseUrl from here).
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await getStorageAdapter().removeItem(TOKEN_KEY);
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  }
);
