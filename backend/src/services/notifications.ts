import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../db.js';
import nodemailer from 'nodemailer';
import { getAllSettings } from './settings.js';
import i18n from '../i18n/index.js';

const expo = new Expo();

export type NotifyType = 'new_post' | 'new_comment' | 'new_like_post' | 'new_like_comment';

// Maps each event to the i18next key (under `notifications.`) used to render
// its message — always in the server's configured defaultLanguage, since
// (unlike the client-only UI) there's no per-user language preference stored
// server-side to render each recipient's copy in their own language.
const MESSAGE_KEY: Record<NotifyType, string> = {
  new_post: 'notifications.newPost',
  new_comment: 'notifications.newComment',
  new_like_post: 'notifications.newLikePost',
  new_like_comment: 'notifications.newLikeComment',
};

const EMAIL_PREF_FIELD: Record<NotifyType, 'emailOnNewPost' | 'emailOnNewComment' | 'emailOnNewLike'> = {
  new_post: 'emailOnNewPost',
  new_comment: 'emailOnNewComment',
  new_like_post: 'emailOnNewLike',
  new_like_comment: 'emailOnNewLike',
};

const PUSH_PREF_FIELD: Record<NotifyType, 'pushOnNewPost' | 'pushOnNewComment' | 'pushOnNewLike'> = {
  new_post: 'pushOnNewPost',
  new_comment: 'pushOnNewComment',
  new_like_post: 'pushOnNewLike',
  new_like_comment: 'pushOnNewLike',
};

interface Recipient {
  id: string;
  email: string;
  emailOnNewPost: boolean;
  emailOnNewComment: boolean;
  emailOnNewLike: boolean;
  pushOnNewPost: boolean;
  pushOnNewComment: boolean;
  pushOnNewLike: boolean;
}

interface NotifyOptions {
  type: NotifyType;
  senderId: string;
  postId: string;
  params: { author: string; group: string };
  recipientIds: string[];
}

export async function createTransporter() {
  const settings = await getAllSettings();
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort || 587,
    secure: (settings.smtpPort || 587) === 465,
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
  });
}

async function notify(options: NotifyOptions) {
  const { type, senderId, postId, params, recipientIds } = options;

  const ids = [...new Set(recipientIds)].filter((id) => id !== senderId);
  if (ids.length === 0) return;

  const recipients = await prisma.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
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
  const message = t(MESSAGE_KEY[type], params);

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type,
      relatedPostId: postId,
      message,
    })),
  });

  await sendPushNotifications(type, recipients, message, settings);
  await sendEmailNotifications(type, recipients, message, settings);
}

// Notifies every other member of a group — used for events that concern the
// whole group (new post, new comment).
export async function notifyGroup(options: {
  type: NotifyType;
  groupId: string;
  senderId: string;
  postId: string;
  params: { author: string; group: string };
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
  postId: string;
  params: { author: string; group: string };
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
  postId: string;
  params: { author: string; group: string };
}) {
  const { userIds, ...rest } = options;
  await notify({ ...rest, recipientIds: userIds });
}

async function sendPushNotifications(
  type: NotifyType,
  recipients: Recipient[],
  message: string,
  settings: Awaited<ReturnType<typeof getAllSettings>>
) {
  if (!settings.pushNotificationsEnabled) return;

  const prefField = PUSH_PREF_FIELD[type];
  const userIds = recipients.filter((r) => r[prefField]).map((r) => r.id);
  if (userIds.length === 0) return;

  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: userIds } },
  });
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));
  if (validTokens.length === 0) return;

  const pushTitle = i18n.getFixedT(settings.defaultLanguage)('notifications.pushTitle');
  const messages: ExpoPushMessage[] = validTokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: pushTitle,
    body: message,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  let cursor = 0;
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      const staleTokens = tickets
        .map((ticket, i) => (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
          ? validTokens[cursor + i].token
          : null))
        .filter((token): token is string => token !== null);

      if (staleTokens.length > 0) {
        await prisma.pushToken.deleteMany({ where: { token: { in: staleTokens } } });
      }
    } catch (err) {
      console.error('Failed to send push notifications', err);
    }
    cursor += chunk.length;
  }
}

async function sendEmailNotifications(
  type: NotifyType,
  recipients: Recipient[],
  message: string,
  settings: Awaited<ReturnType<typeof getAllSettings>>
) {
  if (!settings.emailNotificationsEnabled) return;

  const transporter = await createTransporter();
  if (!transporter) return;

  const prefField = EMAIL_PREF_FIELD[type];
  const t = i18n.getFixedT(settings.defaultLanguage);
  const subject = t('notifications.emailSubject');
  const body = t('notifications.emailBody', { message });

  // Send in parallel so one slow/hanging recipient doesn't serialize the rest.
  await Promise.all(
    recipients
      .filter((recipient) => recipient[prefField])
      .map((recipient) =>
        transporter
          .sendMail({
            from: settings.smtpFrom || 'Famlin <noreply@famlin.app>',
            to: recipient.email,
            subject,
            text: body,
          })
          .catch((err) => console.error('Failed to send email', err))
      )
  );
}
