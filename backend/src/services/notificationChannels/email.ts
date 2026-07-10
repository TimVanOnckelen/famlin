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

export const emailChannel: NotificationChannel = {
  id: 'email',

  isEnabled(settings) {
    return settings.emailNotificationsEnabled;
  },

  wants(recipient: Recipient, type: NotifyType) {
    return recipient[EMAIL_PREF_FIELD[type]];
  },

  async send({ recipients, message, settings }) {
    const transporter = await createTransporter();
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
