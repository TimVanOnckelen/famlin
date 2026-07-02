import { api } from './client';
import { User } from '@/types';

export interface LoginResponse {
  token: string;
  user: User;
}

export interface OidcConfig {
  enabled: boolean;
  name: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes: string;
}

export async function fetchOidcConfig(): Promise<OidcConfig> {
  const response = await api.get<OidcConfig>('/auth/oidc-config');
  return response.data;
}

export async function loginWithOidc(idToken: string, inviteToken?: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/oidc', { idToken, inviteToken });
  return response.data;
}

export async function loginWithPassword(email: string, password: string, inviteToken?: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/login', { email, password, inviteToken });
  return response.data;
}

export async function fetchMe(): Promise<User & { groups: any[] }> {
  const response = await api.get('/auth/me');
  return response.data;
}

export interface NotificationPrefs {
  emailOnNewPost?: boolean;
  emailOnNewComment?: boolean;
  emailOnNewLike?: boolean;
  pushOnNewPost?: boolean;
  pushOnNewComment?: boolean;
  pushOnNewLike?: boolean;
}

export interface UpdateMeBody extends NotificationPrefs {
  avatarUrl?: string | null;
}

export async function updateMe(data: UpdateMeBody): Promise<User> {
  const response = await api.patch('/auth/me', data);
  return response.data;
}

export async function fetchNotificationConfig(): Promise<{ pushEnabled: boolean; emailEnabled: boolean }> {
  const response = await api.get('/auth/notification-config');
  return response.data;
}
