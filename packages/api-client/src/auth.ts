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
  // Sign in with Apple needs no server-side configuration, so it's true on
  // every server that supports it at all — optional here so a client talking
  // to a server predating POST /auth/apple reads it as undefined and hides
  // the button rather than offering a login that would 404.
  appleSignInEnabled?: boolean;
}

export async function fetchOidcConfig(): Promise<OidcConfig> {
  const response = await api.get<OidcConfig>('/auth/oidc-config');
  return response.data;
}

export async function loginWithOidc(idToken: string, inviteToken?: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/oidc', { idToken, inviteToken });
  return response.data;
}

// Sign in with Apple. `fullName` is only available on the user's very first
// authorization for this app — Apple never discloses it again, so pass it
// through when present and omit it otherwise (the server keeps the name
// already on file).
export async function loginWithApple(
  identityToken: string,
  fullName?: string,
  inviteToken?: string
): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/apple', { identityToken, fullName, inviteToken });
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

// minAppVersion/appStoreUrl/playStoreUrl are optional so a client talking to
// an older server (that only ever returned `version`) still parses the
// response — see compareVersions() in ./version for how mobile is meant to
// use minAppVersion to gate a blocking "update required" screen.
export interface ServerInfo {
  version: string;
  minAppVersion?: string;
  appStoreUrl?: string | null;
  playStoreUrl?: string | null;
  readOnly?: boolean;
}

export async function fetchServerInfo(): Promise<ServerInfo> {
  const response = await api.get('/auth/server-info');
  return response.data;
}

// Permanently deletes the logged-in user's own account and everything it
// cascades to (posts, comments, reactions, favorites, chat messages,
// notifications). There is no restore — callers must confirm first.
export async function deleteAccount(): Promise<void> {
  await api.delete('/auth/me');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword });
}
