import { api } from './client';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export function getUploadUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export async function uploadImages(files: { uri: string; name: string; type: string }[]): Promise<string[]> {
  const formData = new FormData();

  files.forEach((file, index) => {
    formData.append(`file${index}`, {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
  });

  console.log('Uploading images to', api.defaults.baseURL + '/uploads', 'files:', files.length);
  const response = await api.post<{ urls: string[] }>('/uploads', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  console.log('Upload response:', response.data);

  return response.data.urls;
}
