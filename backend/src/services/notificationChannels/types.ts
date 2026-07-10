import type { ServerSettings } from '../settings.js';

// The closed set of notification event types — Notification.type in the DB is
// a plain string, so this union is its single source of truth.
export type NotifyType =
  | 'new_post'
  | 'new_comment'
  | 'new_like_post'
  | 'new_like_comment'
  | 'mention'
  | 'on_this_day';

// The recipient shape notify() loads once and hands to every channel — each
// channel picks the preference columns it cares about via wants().
export interface Recipient {
  id: string;
  email: string;
  emailOnNewPost: boolean;
  emailOnNewComment: boolean;
  emailOnNewLike: boolean;
  pushOnNewPost: boolean;
  pushOnNewComment: boolean;
  pushOnNewLike: boolean;
}

export interface ChannelSendArgs {
  type: NotifyType;
  // Already narrowed to the recipients whose preferences opted into this
  // channel for this type (see wants()) — send() delivers to all of them.
  recipients: Recipient[];
  message: string;
  settings: ServerSettings;
  postId: string;
}

// A delivery mechanism for notifications. The in-app Notification row is NOT
// a channel — it's the history feature and is always written by notify();
// channels are the optional ways that history additionally reaches people
// (push, email, and whatever integration comes next). One file per channel in
// this directory, registered in ./index.ts.
export interface NotificationChannel {
  id: string;
  // Server-level switch (admin settings) — checked once per notify() call.
  isEnabled(settings: ServerSettings): boolean;
  // Per-recipient preference for this event type.
  wants(recipient: Recipient, type: NotifyType): boolean;
  // Must not throw for per-recipient failures — log and continue, so one bad
  // address/token never blocks the rest. notify() additionally traps a
  // channel-level throw so one broken channel can't stop the others.
  send(args: ChannelSendArgs): Promise<void>;
}
