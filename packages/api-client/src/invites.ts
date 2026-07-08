import { api } from './client';
import { LoginResponse } from './auth';

export interface InvitePreview {
  status: 'valid' | 'expired' | 'used' | 'not_found';
  groupName?: string;
  groupDescription?: string | null;
  inviterName?: string | null;
  email?: string | null;
}

export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const response = await api.get<InvitePreview>(`/invites/${token}`);
  return response.data;
}

export async function registerViaInvite(
  token: string,
  data: { name: string; email?: string; password: string }
): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>(`/invites/${token}/register`, data);
  return response.data;
}

export async function acceptInvite(token: string): Promise<{ success: boolean; groupId: string }> {
  const response = await api.post(`/invites/${token}/accept`);
  return response.data;
}
