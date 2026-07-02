import axios from 'axios';
import { getToken, deleteToken, getServerUrl } from '@/utils/storage';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

let currentServerUrl = DEFAULT_API_URL.replace(/\/+$/, '');
let currentBaseUrl = `${currentServerUrl}/api`;

export function setApiBaseUrl(serverUrl: string) {
  const normalized = serverUrl.trim().replace(/\/$/, '');
  currentServerUrl = normalized;
  currentBaseUrl = `${normalized}/api`;
}

export function getCurrentServerUrl(): string {
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
  config.baseURL = currentBaseUrl;
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
