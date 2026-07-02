import { api, getCurrentServerUrl, getCurrentMediaToken, setMediaToken } from './client';

// Uploaded photos/videos require a media token (see backend app.ts's
// /uploads onRequest hook) — append the cached one as a query param so
// <Image>/<Video> sources, which can't attach custom headers, can still
// authenticate the GET.
export function getUploadUrl(path: string): string {
  const token = getCurrentMediaToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${getCurrentServerUrl()}${path}${query}`;
}

export async function refreshMediaToken(): Promise<void> {
  try {
    const response = await api.get<{ token: string }>('/uploads/media-token');
    setMediaToken(response.data.token);
  } catch {
    setMediaToken(null);
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

  const response = await api.post<{ urls: string[] }>('/uploads', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data.urls;
}
