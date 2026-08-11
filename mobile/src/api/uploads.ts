import type { AxiosProgressEvent } from 'axios';

import { api } from './client';
import { UPLOAD_TIMEOUT_MS } from '@famlin/api-client';

export { getUploadUrl, refreshMediaToken, ensureFreshMediaToken } from '@famlin/api-client';

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

interface UploadMediaFileOptions {
  /** Called with 0..1 as bytes go out. React Native's XHR layer emits real
   * upload progress events, so this reflects actual uplink progress rather
   * than a fake animation. */
  onProgress?: (fraction: number) => void;
  /** Aborts the in-flight request (the composer cancelling a batch). */
  signal?: AbortSignal;
}

/**
 * Uploads ONE file per request. The batch endpoint accepts many parts in a
 * single request, but sending them one-per-request is what buys per-file
 * progress, per-file retry (a failure loses one photo instead of the whole
 * pick), and genuine parallelism — both on the wire and in the backend's
 * variant generation, which processes the parts of a single request in
 * sequence. Callers should go through the upload queue
 * (stores/uploadQueue.ts) rather than calling this directly, so concurrency
 * stays bounded.
 */
export async function uploadMediaFile(file: UploadFile, options: UploadMediaFileOptions = {}): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as any);

  // Don't set a Content-Type of our own: React Native's networking layer
  // must generate its own `multipart/form-data; boundary=...` header when it
  // detects a FormData body, and setting one manually (with or without a
  // boundary) prevents that, breaking the multipart encoding — this is what
  // surfaces as an opaque "Network Error" / dropped upload. We do still need
  // to clear the client's default `application/json` Content-Type (see
  // @famlin/api-client's client.ts), since otherwise axios's transformRequest
  // treats this as a JSON request and serializes the FormData instead of
  // sending it as-is.
  const response = await api.post<{ urls: string[] }>('/uploads', formData, {
    headers: {
      'Content-Type': undefined,
    },
    // The client's default 15s timeout is a JSON-API budget; a photo — let
    // alone a video — on mobile data routinely needs far longer, and the
    // aborted request surfaces to the user as an opaque "Network Error".
    timeout: UPLOAD_TIMEOUT_MS,
    signal: options.signal,
    onUploadProgress: options.onProgress
      ? (event: AxiosProgressEvent) => {
          const total = event.total ?? 0;
          if (total > 0) options.onProgress!(Math.min(1, event.loaded / total));
        }
      : undefined,
  });

  const url = response.data.urls[0];
  if (!url) {
    // A 200 with no URL would be a server bug, but treat it as a failed
    // upload rather than returning undefined into the caller's url list.
    throw new Error('Upload returned no URL');
  }
  return url;
}
