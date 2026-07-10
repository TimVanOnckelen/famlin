import { api } from './client';
import { User } from './types';

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
  // True when the provider requires a client secret (e.g. Google) — the app
  // can't do the PKCE exchange itself in that case, and instead goes through
  // mobileCallbackUrl + POST /oidc/mobile-handoff. See utils/oidcLogin.ts.
  usesClientSecret: boolean;
  mobileCallbackUrl?: string;
}

export async function fetchOidcConfig(): Promise<OidcConfig> {
  const response = await api.get<OidcConfig>('/auth/oidc-config');
  return response.data;
}

export async function loginWithOidc(idToken: string, inviteToken?: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/oidc', { idToken, inviteToken });
  return response.data;
}

export async function exchangeOidcMobileHandoff(code: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/oidc/mobile-handoff', { code });
  return response.data;
}

// Server-mediated code exchange for providers that require a client secret
// (e.g. Google) — the backend holds the secret and does the exchange. Used
// by browser surfaces (admin/web) after an Authorization Code + PKCE
// redirect; mobile uses the mobile-callback/mobile-handoff pair instead.
export async function exchangeOidcCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  inviteToken?: string
): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/oidc/exchange', {
    code,
    redirectUri,
    codeVerifier,
    inviteToken,
  });
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

export async function fetchServerInfo(): Promise<{ version: string }> {
  const response = await api.get('/auth/server-info');
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword });
}
