import { api, getCurrentServerUrl } from './client';
import { getStorageAdapter, TOKEN_KEY } from './storage';
import { User, Group } from './types';

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

export async function fetchMe(): Promise<User & { groups: Group[] }> {
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
  pushOnStory?: boolean;
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
  // Per-family branding (issue #164). `null` on an unbranded server, absent
  // on a server that predates the feature — treat both as "today's look".
  branding?: Branding | null;
}

// The family's derived palette — computed server-side (one implementation
// for every client), applied as-is: web overrides its CSS custom properties,
// mobile its `colors` constants.
export interface BrandPalette {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryTint: string;
  bg: string;
  // Login screen background: a gradient between these two (equal = flat).
  loginBgFrom: string;
  loginBgTo: string;
}

// Post-type colors, shifted to an alternate hue when the brand would collide
// with them (so a circle post never looks like a normal family post).
export interface BrandSemantic {
  accent: string;
  updateBg: string;
  circle: string;
  circleDark: string;
  circleTint: string;
  milestone: string;
  milestoneBg: string;
  milestoneText: string;
  milestoneDivider: string;
  trip: string;
  tripDark: string;
  tripBg: string;
  tripTint: string;
  tripBorder: string;
}

export interface Branding {
  // The family's name ("The Janssens"), or null to keep "Famlin".
  name: string | null;
  // Public, server-relative paths (/branding/...) — resolve with
  // getBrandingAssetUrl(). Content-addressed, so safe to cache forever.
  logoUrl: string | null;
  faviconUrl: string | null;
  palette: BrandPalette;
  semantic: BrandSemantic;
  // Changes whenever anything above changes.
  hash: string;
}

// Absolute URL for a branding asset path, for clients (mobile) that don't
// share the server's origin. Branding assets are public — no media token.
export function getBrandingAssetUrl(path: string, serverUrl = getCurrentServerUrl()): string {
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}${path}` : path;
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

// Self-service data export (GET /api/auth/me/export): a zip of everything
// the caller can see in their groups — other members' posts included — plus
// the photos/videos it references. Can be large, so no request timeout.
// Browser callers (web) take the Blob and save it; mobile streams straight
// to disk instead via getMyExportRequest(), since holding a whole family's
// media in JS memory would not survive on a phone.
export async function downloadMyExport(): Promise<Blob> {
  const response = await api.get<Blob>('/auth/me/export', { responseType: 'blob', timeout: 0 });
  return response.data;
}

// The absolute URL + auth header for the export, for a native downloader
// that writes to a file rather than going through axios.
export async function getMyExportRequest(): Promise<{ url: string; headers: Record<string, string> }> {
  const serverUrl = getCurrentServerUrl();
  if (!serverUrl) throw new Error('No server URL configured');
  const token = await getStorageAdapter().getItem(TOKEN_KEY);
  return {
    url: `${serverUrl}/api/auth/me/export`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword });
}
