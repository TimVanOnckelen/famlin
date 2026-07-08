import { api } from './client';
import { Notification } from './types';

export async function fetchNotifications(): Promise<Notification[]> {
  const response = await api.get<Notification[]>('/notifications');
  return response.data;
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await api.get<{ count: number }>('/notifications/unread-count');
  return response.data.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.patch(`/notifications/${id}`, { read: true });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/mark-all-read');
}
