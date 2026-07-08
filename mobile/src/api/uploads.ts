import { api } from './client';

export { getUploadUrl, refreshMediaToken, ensureFreshMediaToken } from '@famlin/api-client';

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
  // @famlin/api-client's client.ts), since otherwise axios's transformRequest
  // treats this as a JSON request and serializes the FormData instead of
  // sending it as-is.
  const response = await api.post<{ urls: string[] }>('/uploads', formData, {
    headers: {
      'Content-Type': undefined,
    },
  });

  return response.data.urls;
}
