import { api } from './client';
import { Group } from './types';

export interface GroupMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  joinedAt: string;
}

export async function fetchGroups(): Promise<Group[]> {
  const response = await api.get<Group[]>('/groups');
  return response.data;
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const response = await api.get<GroupMember[]>(`/groups/${groupId}/members`);
  return response.data;
}
