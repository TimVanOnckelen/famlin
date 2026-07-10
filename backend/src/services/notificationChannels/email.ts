import nodemailer from 'nodemailer';
import i18n from '../../i18n/index.js';
import { getAllSettings } from '../settings.js';
import type { NotificationChannel, NotifyType, Recipient } from './types.js';

// Mirrors PUSH_PREF_FIELD in push.ts — mention/on_this_day reuse the closest
// existing preference column, see the note there.
const EMAIL_PREF_FIELD: Record<NotifyType, 'emailOnNewPost' | 'emailOnNewComment' | 'emailOnNewLike'> = {
  new_post: 'emailOnNewPost',
  new_comment: 'emailOnNewComment',
  new_like_post: 'emailOnNewLike',
  new_like_comment: 'emailOnNewLike',
  mention: 'emailOnNewComment',
  on_this_day: 'emailOnNewPost',
};

export async function createTransporter(settings?: Awaited<ReturnType<typeof getAllSettings>>) {
  const resolved = settings ?? (await getAllSettings());
  if (!resolved.smtpHost || !resolved.smtpUser || !resolved.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: resolved.smtpHost,
    port: resolved.smtpPort || 587,
    secure: (resolved.smtpPort || 587) === 465,
    auth: {
      user: resolved.smtpUser,
      pass: resolved.smtpPass,
    },
  });
}

export const emailChannel: NotificationChannel = {
  id: 'email',

  isEnabled(settings) {
    return settings.emailNotificationsEnabled;
  },

  wants(recipient: Recipient, type: NotifyType) {
    return recipient[EMAIL_PREF_FIELD[type]];
  },

  async send({ recipients, message, settings }) {
    const transporter = await createTransporter(settings);
    if (!transporter) return;

    const t = i18n.getFixedT(settings.defaultLanguage);
    const subject = t('notifications.emailSubject');
    const body = t('notifications.emailBody', { message });

    // Send in parallel so one slow/hanging recipient doesn't serialize the rest.
    await Promise.all(
      recipients.map((recipient) =>
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
  },
};
