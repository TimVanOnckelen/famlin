import axios from 'axios';
import { getToken, deleteToken, getServerUrl } from '@/utils/storage';

// Dev convenience only — in every other case the base URL comes from
// initApiBaseUrl() (stored server) or setApiBaseUrl() (login/invite flow).
// There is deliberately no hardcoded localhost fallback: silently targeting
// localhost when neither of those has run yet would mask real failures
// instead of surfacing them.
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;

let currentServerUrl: string | null = DEFAULT_API_URL ? DEFAULT_API_URL.replace(/\/+$/, '') : null;
let currentBaseUrl: string | null = currentServerUrl ? `${currentServerUrl}/api` : null;

export function setApiBaseUrl(serverUrl: string) {
  const normalized = serverUrl.trim().replace(/\/$/, '');
  currentServerUrl = normalized;
  currentBaseUrl = `${normalized}/api`;
}

export function getCurrentServerUrl(): string | null {
  return currentServerUrl;
}

// A short-lived, narrow-scope token (separate from the main session token)
// used only to authorize GETs under /uploads — cached in memory so
// getUploadUrl() can stay synchronous for use directly in <Image>/<Video>
// source props. See api/uploads.ts and the backend's onRequest hook in app.ts.
let currentMediaToken: string | null = null;

export function setMediaToken(token: string | null) {
  currentMediaToken = token;
}

export function getCurrentMediaToken(): string | null {
  return currentMediaToken;
}

export async function initApiBaseUrl() {
  const stored = await getServerUrl();
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
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Lets authStore react to a 401 (expired/revoked session) without api/client.ts
// importing the store directly, which would create a circular import
// (authStore already imports setApiBaseUrl from this file).
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await deleteToken();
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  }
);
