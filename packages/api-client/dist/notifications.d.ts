import { Notification } from './types';
export declare function fetchNotifications(): Promise<Notification[]>;
export declare function fetchUnreadNotificationCount(): Promise<number>;
export declare function markNotificationRead(id: string): Promise<void>;
export declare function markAllNotificationsRead(): Promise<void>;
