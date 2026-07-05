import { api, getCurrentServerUrl, getCurrentMediaToken, setMediaToken } from './client';

// Uploaded photos/videos require a media token (see backend app.ts's
// /uploads onRequest hook) — append the cached one as a query param so
// <Image>/<Video> sources, which can't attach custom headers, can still
// authenticate the GET.
export function getUploadUrl(path: string): string {
  const serverUrl = getCurrentServerUrl();
  // No server URL yet (pre-init) — return the raw path rather than a
  // "nullundefined"-style string; the caller has nothing usable to load yet.
  if (!serverUrl) return path;
  const token = getCurrentMediaToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${serverUrl}${path}${query}`;
}

let mediaTokenFetchedAt: number | null = null;
const MEDIA_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export async function refreshMediaToken(): Promise<void> {
  // The media token TTL (7d) is shorter than the session token TTL (30d), and
  // RN <Image>/<Video> requests bypass axios entirely (no 401 handler), so a
  // dropped request here has no other retry path — try a second time before
  // giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await api.get<{ token: string }>('/uploads/media-token');
      setMediaToken(response.data.token);
      mediaTokenFetchedAt = Date.now();
      return;
    } catch {
      if (attempt === 1) {
        setMediaToken(null);
        mediaTokenFetchedAt = null;
      }
    }
  }
}

// Called when the app returns to the foreground while a user is signed in —
// re-fetches the media token if it's missing (e.g. a previous refresh failed)
// or has gone stale, since nothing else proactively refreshes it.
export async function ensureFreshMediaToken(): Promise<void> {
  const isStale = mediaTokenFetchedAt === null || Date.now() - mediaTokenFetchedAt > MEDIA_TOKEN_MAX_AGE_MS;
  if (!getCurrentMediaToken() || isStale) {
    await refreshMediaToken();
  }
}

export async function uploadMedia(files: { uri: string; name: string; type: string }[]): Promise<string[]> {
  const formData = new FormData();

  files.forEach((file, index) => {
    formData.append(`file${index}`, {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
  });

  // Don't set a Content-Type of our own: React Native's networking layer
  // must generate its own `multipart/form-data; boundary=...` header when it
  // detects a FormData body, and setting one manually (with or without a
  // boundary) prevents that, breaking the multipart encoding — this is what
  // surfaces as an opaque "Network Error" / dropped upload. We do still need
  // to clear the client's default `application/json` Content-Type (see
  // client.ts), since otherwise axios's transformRequest treats this as a
  // JSON request and serializes the FormData instead of sending it as-is.
  //
  // Disable the default axios timeout for uploads: the global 15 s limit is
  // fine for small JSON requests but is far too short for photo/video uploads
  // over typical mobile or remote-server network speeds, which causes every
  // upload to fail with a spurious timeout error.
  const response = await api.post<{ urls: string[] }>('/uploads', formData, {
    headers: {
      'Content-Type': undefined,
    },
    timeout: 0,
  });

  return response.data.urls;
}
