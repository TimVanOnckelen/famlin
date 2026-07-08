import { api } from './client';

// Developer personal access tokens (PATs) — long-lived credentials a member
// creates to call the Famlin API from their own scripts/integrations. The
// plaintext token is only present on the create response; every later fetch
// only sees the non-secret preview.
export interface ApiToken {
  id: string;
  name: string;
  tokenPreview: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken extends ApiToken {
  /** Full secret (`famlin_pat_...`) — shown once, never retrievable again. */
  token: string;
}

export async function fetchApiTokens(): Promise<ApiToken[]> {
  const res = await api.get<{ items: ApiToken[] }>('/api-tokens');
  return res.data.items;
}

export async function createApiToken(body: { name: string; expiresInDays?: number }): Promise<CreatedApiToken> {
  const res = await api.post<CreatedApiToken>('/api-tokens', body);
  return res.data;
}

export async function revokeApiToken(id: string): Promise<void> {
  await api.delete(`/api-tokens/${id}`);
}
