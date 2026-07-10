import type { NotificationChannel } from './types.js';
import { pushChannel } from './push.js';
import { emailChannel } from './email.js';

// The static channel registry notify() fans out to. Adding a delivery
// mechanism (Telegram, ntfy, ...) = implement NotificationChannel in a new
// file here and add it to this list.
export const notificationChannels: NotificationChannel[] = [pushChannel, emailChannel];

export type { NotificationChannel, NotifyType, Recipient, ChannelSendArgs } from './types.js';
