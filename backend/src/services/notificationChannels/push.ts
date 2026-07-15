import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../../db.js';
import i18n from '../../i18n/index.js';
import type { ChannelSendArgs, NotificationChannel, NotifyType, Recipient } from './types.js';

const expo = new Expo();

export interface PushSendResult {
  tokenCount: number;
  successCount: number;
  failureCount: number;
}

// Mentions, "on this day" memories, and new-media-assets alerts all reuse the
// closest existing preference column (comment activity / new post activity)
// rather than adding more boolean columns + admin UI toggles for an
// MVP-scale feature set.
const PUSH_PREF_FIELD: Record<NotifyType, 'pushOnNewPost' | 'pushOnNewComment' | 'pushOnNewLike'> = {
  new_post: 'pushOnNewPost',
  new_comment: 'pushOnNewComment',
  new_like_post: 'pushOnNewLike',
  new_like_comment: 'pushOnNewLike',
  mention: 'pushOnNewComment',
  on_this_day: 'pushOnNewPost',
  new_media_assets: 'pushOnNewPost',
};

// The actual send, plus its PushDeliveryLog write — shared by the organic
// NotificationChannel path (pushChannel.send, below) and the admin "resend
// push" content-moderation action (services/notifications.ts's
// resendPostPush), which calls this directly so it can read back the
// per-send counts the NotificationChannel interface's `Promise<void>`
// deliberately hides from callers that only iterate the generic channel
// list.
export async function sendPush(args: ChannelSendArgs): Promise<PushSendResult> {
  const { recipients, message, settings, postId, type, triggeredByAdminId } = args;
  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: recipients.map((r) => r.id) } },
  });
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));

  let successCount = 0;
  let failureCount = 0;

  if (validTokens.length > 0) {
    const pushTitle = i18n.getFixedT(settings.defaultLanguage)('notifications.pushTitle');
    const messages: ExpoPushMessage[] = validTokens.map((t) => ({
      to: t.token,
      sound: 'default',
      title: pushTitle,
      body: message,
      // Lets the client's notification-tap handler navigate straight to the
      // relevant post (see mobile's usePushNotifications.ts).
      data: { relatedPostId: postId },
    }));

    const chunks = expo.chunkPushNotifications(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        const staleTokens: string[] = [];

        for (const [i, ticket] of tickets.entries()) {
          if (ticket.status === 'ok') {
            successCount += 1;
            continue;
          }
          failureCount += 1;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            staleTokens.push(validTokens[cursor + i].token);
          } else {
            console.error(
              `Push ticket error (${ticket.details?.error ?? 'unknown'}) for token ${validTokens[cursor + i].token}: ${ticket.message}`,
            );
          }
        }

        if (staleTokens.length > 0) {
          await prisma.pushToken.deleteMany({ where: { token: { in: staleTokens } } });
        }
      } catch (err) {
        console.error('Failed to send push notifications', err);
        failureCount += chunk.length;
      }
      cursor += chunk.length;
    }
  }

  await prisma.pushDeliveryLog.create({
    data: {
      postId,
      notifyType: type,
      recipientCount: recipients.length,
      tokenCount: validTokens.length,
      successCount,
      failureCount,
      triggeredByAdminId: triggeredByAdminId ?? null,
    },
  });

  return { tokenCount: validTokens.length, successCount, failureCount };
}

export const pushChannel: NotificationChannel = {
  id: 'push',

  isEnabled(settings) {
    return settings.pushNotificationsEnabled;
  },

  wants(recipient: Recipient, type: NotifyType) {
    return recipient[PUSH_PREF_FIELD[type]];
  },

  async send(args) {
    await sendPush(args);
  },
};
