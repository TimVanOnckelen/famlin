import { prisma } from '../db.js';
import { getAllSettings } from './settings.js';
import i18n from '../i18n/index.js';
import { notificationChannels } from './notificationChannels/index.js';
import { pushChannel, sendPush } from './notificationChannels/push.js';
import type { NotifyType, Recipient } from './notificationChannels/types.js';

export type { NotifyType, Recipient } from './notificationChannels/types.js';
// Re-exported for callers that only need the SMTP transport (not a full
// notification), so they don't have to know channels moved.
export { createTransporter } from './notificationChannels/email.js';

// No real user has this id, so notifyGroup's sender-exclusion filter never
// excludes anyone — used by system-generated notifications (on-this-day,
// new-media-assets) that aren't "from" any group member.
export const SYSTEM_SENDER_ID = '__system__';

const EXCERPT_MAX_LENGTH = 80;

// Trims a post/comment body down to a short quote for notification text.
// Collapses newlines so a multi-line post doesn't blow up a one-line
// notification. `fallback` fills the quote for an attachment-only comment
// with no text of its own (a plain emoji, like reactionEmoji below, needs no
// translation) rather than leaving the notification with an empty `""`.
export function excerptText(content?: string | null, fallback = ''): string {
  if (!content) return fallback;
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback;
  return collapsed.length > EXCERPT_MAX_LENGTH
    ? `${collapsed.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…`
    : collapsed;
}

// Mirrors mobile's constants/reactions.ts REACTION_EMOJI — kept as a small
// local copy rather than a shared package since this is the only backend use.
const REACTION_EMOJI: Record<string, string> = {
  LIKE: '👍',
  LOVE: '❤️',
  HAHA: '😂',
  WOW: '😮',
  SAD: '😢',
  CARE: '🥰',
};

export function reactionEmoji(type: string): string {
  return REACTION_EMOJI[type] ?? REACTION_EMOJI.LIKE;
}

// Maps each event to the i18next key (under `notifications.`) used to render
// its message — always in the server's configured defaultLanguage, since
// (unlike the client-only UI) there's no per-user language preference stored
// server-side to render each recipient's copy in their own language.
const MESSAGE_KEY: Record<NotifyType, string> = {
  new_post: 'notifications.newPost',
  new_comment: 'notifications.newComment',
  new_like_post: 'notifications.newLikePost',
  new_like_comment: 'notifications.newLikeComment',
  mention: 'notifications.mention',
  on_this_day: 'notifications.onThisDay',
  new_media_assets: 'notifications.newMediaAssets',
};

// Posts (and the posts on-this-day resurfaces) can be photo/video-only with
// no text — these types fall back to a "media" variant of their template
// when `params.excerpt` is empty, since new_comment/mention/new_like_comment
// always have text (a comment can't be empty) and don't need one.
const MEDIA_MESSAGE_KEY: Partial<Record<NotifyType, string>> = {
  new_post: 'notifications.newPostMedia',
  new_like_post: 'notifications.newLikePostMedia',
  on_this_day: 'notifications.onThisDayMedia',
};

function resolveMessageKey(type: NotifyType, params: Record<string, string | number>): string {
  const hasExcerpt = typeof params.excerpt === 'string' && params.excerpt.trim().length > 0;
  if (!hasExcerpt && MEDIA_MESSAGE_KEY[type]) return MEDIA_MESSAGE_KEY[type]!;
  return MESSAGE_KEY[type];
}

interface NotifyOptions {
  type: NotifyType;
  senderId: string;
  // Omitted (or null) for event types with no associated post — currently
  // only new_media_assets, which is scoped to an album/group instead of a
  // single post.
  postId?: string | null;
  // Extra keys beyond author/group (e.g. `count` for on-this-day's
  // "N years ago" pluralization) are simply ignored by templates that don't
  // reference them, so this stays permissive rather than per-type.
  params: Record<string, string | number>;
  recipientIds: string[];
}

async function notify(options: NotifyOptions) {
  const { type, senderId, params, recipientIds } = options;
  const postId = options.postId ?? null;

  const ids = [...new Set(recipientIds)].filter((id) => id !== senderId);
  if (ids.length === 0) return;

  const recipients: Recipient[] = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      email: true,
      emailOnNewPost: true,
      emailOnNewComment: true,
      emailOnNewLike: true,
      pushOnNewPost: true,
      pushOnNewComment: true,
      pushOnNewLike: true,
    },
  });
  if (recipients.length === 0) return;

  const settings = await getAllSettings();
  const t = i18n.getFixedT(settings.defaultLanguage);
  const message = t(resolveMessageKey(type, params), params);

  // The in-app history row is written unconditionally — channels below are
  // the optional deliveries of it.
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type,
      relatedPostId: postId,
      message,
    })),
  });

  // Channels run in parallel and each failure is trapped, so one broken
  // delivery mechanism never blocks the others.
  await Promise.all(
    notificationChannels.map(async (channel) => {
      if (!channel.isEnabled(settings)) return;
      const wanted = recipients.filter((r) => channel.wants(r, type));
      if (wanted.length === 0) return;
      try {
        await channel.send({ type, recipients: wanted, message, settings, postId });
      } catch (err) {
        console.error(`Notification channel "${channel.id}" failed`, err);
      }
    })
  );
}

// Notifies every other member of a group — used for events that concern the
// whole group (new post, new comment).
export async function notifyGroup(options: {
  type: NotifyType;
  groupId: string;
  senderId: string;
  postId?: string | null;
  // Extra keys beyond author/group (e.g. `count` for on-this-day's
  // "N years ago" pluralization) are simply ignored by templates that don't
  // reference them, so this stays permissive rather than per-type.
  params: Record<string, string | number>;
}) {
  const { groupId, ...rest } = options;
  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { not: options.senderId } },
  });

  await notify({ ...rest, recipientIds: members.map((m) => m.userId) });
}

// Notifies a single user — used for events that only concern one person
// (e.g. someone liking their post).
export async function notifyUser(options: {
  type: NotifyType;
  userId: string;
  senderId: string;
  postId?: string | null;
  // Extra keys beyond author/group (e.g. `count` for on-this-day's
  // "N years ago" pluralization) are simply ignored by templates that don't
  // reference them, so this stays permissive rather than per-type.
  params: Record<string, string | number>;
}) {
  const { userId, ...rest } = options;
  await notify({ ...rest, recipientIds: [userId] });
}

// Notifies an explicit set of users — used for events that concern people
// engaged with a specific thread (the post's author and anyone who has
// already commented on it), rather than the whole group.
export async function notifyUsers(options: {
  type: NotifyType;
  userIds: string[];
  senderId: string;
  postId?: string | null;
  // Extra keys beyond author/group (e.g. `count` for on-this-day's
  // "N years ago" pluralization) are simply ignored by templates that don't
  // reference them, so this stays permissive rather than per-type.
  params: Record<string, string | number>;
}) {
  const { userIds, ...rest } = options;
  await notify({ ...rest, recipientIds: userIds });
}

// Thrown for expected, user-facing push-send failures so routes can map them
// to a translated message instead of leaking internals (same pattern as
// PostTypeError in services/postTypes/types.ts). `code` is an i18n error key
// suffix and always maps to HTTP 400.
export class PushNotificationError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'PushNotificationError';
  }
}

export interface PostPushResendResult {
  recipientCount: number;
  tokenCount: number;
  successCount: number;
  failureCount: number;
}

// Admin-only manual resend of a post's "new post" push notification — e.g. a
// member missed it because their device was offline when it first fired.
// Deliberately push-only: it doesn't touch email and doesn't re-create the
// in-app Notification row (already written by the original post.created
// event), only re-delivers the OS-level push. Returns null if the post
// doesn't exist, so the caller can 404.
export async function resendPostPush(
  postId: string,
  triggeredByAdminId: string
): Promise<PostPushResendResult | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      content: true,
      authorId: true,
      groupId: true,
      author: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  if (!post) return null;

  const settings = await getAllSettings();
  if (!settings.pushNotificationsEnabled) {
    throw new PushNotificationError('pushNotificationsDisabled');
  }

  const members = await prisma.groupMember.findMany({
    where: { groupId: post.groupId, userId: { not: post.authorId } },
    select: { userId: true },
  });
  if (members.length === 0) {
    return { recipientCount: 0, tokenCount: 0, successCount: 0, failureCount: 0 };
  }

  const recipients: Recipient[] = await prisma.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: {
      id: true,
      email: true,
      emailOnNewPost: true,
      emailOnNewComment: true,
      emailOnNewLike: true,
      pushOnNewPost: true,
      pushOnNewComment: true,
      pushOnNewLike: true,
    },
  });

  const wanted = recipients.filter((r) => pushChannel.wants(r, 'new_post'));
  if (wanted.length === 0) {
    return { recipientCount: recipients.length, tokenCount: 0, successCount: 0, failureCount: 0 };
  }

  const params = { author: post.author.name, group: post.group.name, excerpt: excerptText(post.content) };
  const t = i18n.getFixedT(settings.defaultLanguage);
  const message = t(resolveMessageKey('new_post', params), params);

  const result = await sendPush({
    type: 'new_post',
    recipients: wanted,
    message,
    settings,
    postId: post.id,
    triggeredByAdminId,
  });

  return { recipientCount: recipients.length, ...result };
}
