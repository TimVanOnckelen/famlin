import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { config } from '../config.js';
import { prisma } from '../db.js';
import nodemailer from 'nodemailer';

const expo = new Expo();

let transporter: nodemailer.Transporter | null = null;

if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT || 587,
    secure: (config.SMTP_PORT || 587) === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
}

interface NotifyGroupOptions {
  type: 'new_post' | 'new_comment' | 'new_like';
  groupId: string;
  senderId: string;
  postId: string;
  message: string;
}

export async function notifyGroup(options: NotifyGroupOptions) {
  const { type, groupId, senderId, postId, message } = options;

  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { not: senderId } },
    include: { user: true },
  });

  for (const member of members) {
    await prisma.notification.create({
      data: {
        userId: member.userId,
        type,
        relatedPostId: postId,
        message,
      },
    });
  }

  await sendPushNotifications(members.map((m) => m.user), message);
  await sendEmailNotifications(members.map((m) => m.user), message);
}

async function sendPushNotifications(users: { id: string }[], message: string) {
  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
  });

  const messages: ExpoPushMessage[] = [];

  for (const token of tokens) {
    if (!Expo.isExpoPushToken(token.token)) continue;

    messages.push({
      to: token.token,
      sound: 'default',
      title: 'Famlin',
      body: message,
    });
  }

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error('Failed to send push notifications', err);
    }
  }
}

async function sendEmailNotifications(
  users: { id: string; email: string; emailNotificationsEnabled: boolean }[],
  message: string
) {
  if (!transporter) return;

  for (const user of users) {
    if (!user.emailNotificationsEnabled) continue;

    try {
      await transporter.sendMail({
        from: config.SMTP_FROM || 'Famlin <noreply@famlin.app>',
        to: user.email,
        subject: 'Nieuwe activiteit op Famlin',
        text: `${message}\n\nBekijk het in de Famlin app.`,
      });
    } catch (err) {
      console.error('Failed to send email', err);
    }
  }
}
