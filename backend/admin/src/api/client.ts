import {
  User,
  Group,
  GroupMember,
  ServerSettings,
  OidcConfig,
  DashboardStats,
  ModerationPost,
  ModerationComment,
  Invite,
  MediaAlbumSummary,
  MediaAlbumLink,
  MediaProviderId,
  NewAssetMode,
  MediaPerson,
  MediaPersonLink,
  ServerInfo,
  PostTypeInfo,
  PostPushResendResult,
  PushDeliveryLog,
} from '../types';

export type {
  User,
  Group,
  GroupMember,
  ServerSettings,
  OidcConfig,
  DashboardStats,
  ModerationPost,
  ModerationComment,
  Invite,
  MediaAlbumSummary,
  MediaAlbumLink,
  MediaProviderId,
  NewAssetMode,
  MediaPerson,
  MediaPersonLink,
  ServerInfo,
  PostTypeInfo,
  PostPushResendResult,
  PushDeliveryLog,
};

export class ApiError extends Error {
  // Machine-readable error code, when the backend sends one (e.g. a media
  // source's `not_configured`/`unreachable`/`unauthorized` — see
  // MediaProviderError in backend/src/services/media/types.ts) — lets callers
  // branch on the failure reason instead of only having a translated message
  // to show.
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ContentFilterParams {
  groupId?: string;
  authorId?: string;
  q?: string;
  cursor?: string;
}

function contentQueryString(params: ContentFilterParams) {
  const query = new URLSearchParams();
  if (params.groupId) query.set('groupId', params.groupId);
  if (params.authorId) query.set('authorId', params.authorId);
  if (params.q) query.set('q', params.q);
  if (params.cursor) query.set('cursor', params.cursor);
  return query.toString();
}

function getToken() {
  return localStorage.getItem('famlin_admin_token');
}

async function request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const method = options?.method || 'GET';
  const headers: Record<string, string> = {};

  // Only set Content-Type when there's an actual body to send — Fastify's
  // default JSON body parser rejects an empty body when this header is
  // present (a POST with no body, e.g. retriggerPostPush below).
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(res.status, data.error || `HTTP ${res.status}`, data.code);
  }

  return res.json();
}

export const api = {
  getSetupStatus: () => request<{ needsSetup: boolean }>('/api/auth/setup-status'),

  setup: (data: { email: string; name: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/setup', {
      method: 'POST',
      body: data,
    }),

  getOidcConfig: () => request<OidcConfig>('/api/auth/oidc-config'),

  loginWithOidc: (idToken: string) =>
    request<{ token: string; user: User }>('/api/auth/oidc', {
      method: 'POST',
      body: { idToken },
    }),

  exchangeOidcCode: (code: string, redirectUri: string, codeVerifier: string) =>
    request<{ token: string; user: User }>('/api/auth/oidc/exchange', {
      method: 'POST',
      body: { code, redirectUri, codeVerifier },
    }),

  loginWithPassword: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  getMe: () => request<User>('/api/auth/me'),

  getStats: () => request<DashboardStats>('/api/admin/stats'),

  // Public endpoint (no auth required) — used by the dashboard's
  // update-available notice.
  getServerInfo: () => request<ServerInfo>('/api/auth/server-info'),

  getUsers: (params: { cursor?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();
    return request<Page<User>>(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  // Used by pickers (e.g. "add member to group") that need the full roster
  // rather than a single page — walks every page and concatenates.
  getAllUsers: async (): Promise<User[]> => {
    const all: User[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.getUsers({ cursor });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  },

  updateUser: (id: string, data: Partial<User>) =>
    request<User>(`/api/admin/users/${id}`, { method: 'PATCH', body: data }),

  deleteUser: (id: string) =>
    request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),

  getGroups: () => request<Group[]>('/api/admin/groups'),

  createGroup: (data: { name: string; description?: string; allowedPostTypes?: string[]; chitchatEnabled?: boolean }) =>
    request<Group>('/api/admin/groups', { method: 'POST', body: data }),

  updateGroup: (id: string, data: { name: string; description?: string; allowedPostTypes?: string[]; chitchatEnabled?: boolean }) =>
    request<Group>(`/api/admin/groups/${id}`, { method: 'PATCH', body: data }),

  // Registry of post types (e.g. UPDATE, MILESTONE, POLL) — used by the group
  // form's "Allowed post types" fieldset.
  getPostTypes: () => request<{ items: PostTypeInfo[] }>('/api/admin/post-types'),

  deleteGroup: (id: string) =>
    request<void>(`/api/admin/groups/${id}`, { method: 'DELETE' }),

  getGroupMembers: (groupId: string) =>
    request<GroupMember[]>(`/api/admin/groups/${groupId}/members`),

  addGroupMember: (groupId: string, userId: string) =>
    request<void>(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      body: { userId },
    }),

  removeGroupMember: (groupId: string, userId: string) =>
    request<void>(`/api/admin/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    }),

  getGroupInvites: (groupId: string) =>
    request<Invite[]>(`/api/admin/groups/${groupId}/invites`),

  createGroupInvite: (groupId: string, data: { email?: string; expiresInDays?: number }) =>
    request<Invite>(`/api/admin/groups/${groupId}/invites`, { method: 'POST', body: data }),

  revokeInvite: (id: string) =>
    request<void>(`/api/admin/invites/${id}`, { method: 'DELETE' }),

  getContentPosts: (params: ContentFilterParams = {}) => {
    const qs = contentQueryString(params);
    return request<Page<ModerationPost>>(`/api/admin/content/posts${qs ? `?${qs}` : ''}`);
  },

  getContentComments: (params: ContentFilterParams = {}) => {
    const qs = contentQueryString(params);
    return request<Page<ModerationComment>>(`/api/admin/content/comments${qs ? `?${qs}` : ''}`);
  },

  deletePost: (id: string) => request<void>(`/api/posts/${id}`, { method: 'DELETE' }),

  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: 'DELETE' }),

  retriggerPostPush: (id: string) =>
    request<PostPushResendResult>(`/api/admin/content/posts/${id}/retrigger-push`, { method: 'POST' }),

  getPushLog: (params: { postId?: string; cursor?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.postId) query.set('postId', params.postId);
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();
    return request<Page<PushDeliveryLog>>(`/api/admin/push-log${qs ? `?${qs}` : ''}`);
  },

  getSettings: () => request<ServerSettings>('/api/admin/settings'),

  updateSettings: (data: Partial<ServerSettings>) =>
    request<ServerSettings>('/api/admin/settings', { method: 'PATCH', body: data }),

  register: (data: { email: string; name: string; password: string; isAdmin?: boolean; groupIds?: string[] }) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: data,
    }),

  resetPassword: (userId: string, newPassword: string) =>
    request<void>(`/api/auth/reset-password/${userId}`, {
      method: 'POST',
      body: { newPassword },
    }),

  testImmichConnection: (serverUrl: string, apiKey: string) =>
    request<{ ok: true } | { ok: false; error: 'unreachable' | 'unauthorized' }>('/api/admin/immich/test', {
      method: 'POST',
      body: { serverUrl, apiKey },
    }),

  testLocalMediaPath: (rootPath: string) =>
    request<{ ok: true } | { ok: false; error: 'not_found' | 'not_a_directory' }>('/api/admin/media/local/test', {
      method: 'POST',
      body: { rootPath },
    }),

  getMediaAlbums: (provider: MediaProviderId) =>
    request<MediaAlbumSummary[]>(`/api/admin/media/${provider}/albums`),

  getGroupMediaAlbums: (groupId: string) =>
    request<MediaAlbumLink[]>(`/api/admin/groups/${groupId}/media-albums`),

  linkMediaAlbum: (groupId: string, data: { provider: MediaProviderId; externalAlbumId: string; albumName: string }) =>
    request<MediaAlbumLink>(`/api/admin/groups/${groupId}/media-albums`, { method: 'POST', body: data }),

  unlinkMediaAlbum: (id: string) =>
    request<void>(`/api/admin/media-albums/${id}`, { method: 'DELETE' }),

  updateMediaAlbumLink: (id: string, data: { newAssetMode: NewAssetMode }) =>
    request<MediaAlbumLink>(`/api/admin/media-albums/${id}`, { method: 'PATCH', body: data }),

  getMediaPeople: (provider: MediaProviderId) =>
    request<MediaPerson[]>(`/api/admin/media/${provider}/people`),

  getMediaPersonLinks: () =>
    request<MediaPersonLink[]>('/api/admin/media/people-links'),

  createMediaPersonLink: (data: { provider: MediaProviderId; externalPersonId: string; label: string; userId?: string }) =>
    request<MediaPersonLink>('/api/admin/media/people-links', { method: 'POST', body: data }),

  deleteMediaPersonLink: (id: string) =>
    request<void>(`/api/admin/media/people-links/${id}`, { method: 'DELETE' }),

  // Not a JSON endpoint (returns a zip stream), so this bypasses request()
  // and does its own auth header + error handling instead.
  downloadExport: async (): Promise<{ blob: Blob; filename: string }> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/admin/export', { headers });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new ApiError(res.status, data.error || `HTTP ${res.status}`, data.code);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `famlin-export-${new Date().toISOString().slice(0, 10)}.zip`;
    return { blob, filename };
  },
};
