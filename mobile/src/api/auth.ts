import { api } from './client';
import { User } from '@/types';

export interface LoginResponse {
  token: string;
  user: User;
}

export async function loginWithGoogle(idToken: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/login', { idToken });
  return response.data;
}

export async function fetchMe(): Promise<User & { groups: any[] }> {
  const response = await api.get('/auth/me');
  return response.data;
}

export async function updateMe(data: { emailNotificationsEnabled?: boolean }): Promise<User> {
  const response = await api.patch('/auth/me', data);
  return response.data;
}

export async function devLogin(email?: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/dev-login', { email });
  return response.data;
}
