import { api } from './client';
import { Circle, CircleMember } from './types';

// Member-facing Circle calls. Circles are FULLY PRIVATE: the server only
// ever returns the circles the caller is actually in, so there is no "list
// all circles in this group" call here by design — a group member outside a
// circle must not learn it exists. Creating, editing and deleting circles,
// and managing their membership, are admin operations exposed only through
// the admin UI.

export async function fetchMyCircles(groupId: string): Promise<Circle[]> {
  const response = await api.get<{ items: Circle[] }>('/circles', { params: { groupId } });
  return response.data.items;
}

export async function fetchCircleMembers(circleId: string): Promise<CircleMember[]> {
  const response = await api.get<{ items: CircleMember[] }>(`/circles/${circleId}/members`);
  return response.data.items;
}

// Leaving a circle never removes you from the family group behind it —
// you simply stop seeing that circle's content. Rejoining requires an admin.
export async function leaveCircle(circleId: string): Promise<void> {
  await api.delete(`/circles/${circleId}/members/me`);
}
