import nodemailer from 'nodemailer'
import { prisma } from '../../db.js'
import i18n from '../../i18n/index.js'
import { getAllSettings } from '../settings.js'
import type { NotificationChannel, NotifyType, Recipient } from './types.js'
import { resolveBrandSettings } from '../branding/index.js'
import { mapWithConcurrency } from '../../utils/concurrency.js'

// Most SMTP providers (Gmail, Fastmail, SES, a typical Postfix) cap concurrent
// connections per client at 3–10 and answer `421 Too many concurrent
// connections` beyond that, so a notification fan-out never opens more than
// this many at once (issue #134).
export const EMAIL_MAX_CONNECTIONS = 3

// Mirrors PUSH_PREF_FIELD in push.ts — mention/on_this_day/new_media_assets
// reuse the closest existing preference column, see the note there.
// Partial (not every NotifyType) because new_chat_message is deliberately
// push-only — chat is chattier than posts/comments, so it never emails
// regardless of preference (see wants() below).
const EMAIL_PREF_FIELD: Partial<Record<NotifyType, 'emailOnNewPost' | 'emailOnNewComment' | 'emailOnNewLike'>> = {
  new_post: 'emailOnNewPost',
  new_comment: 'emailOnNewComment',
  new_like_post: 'emailOnNewLike',
  new_like_comment: 'emailOnNewLike',
  mention: 'emailOnNewComment',
  on_this_day: 'emailOnNewPost',
  new_media_assets: 'emailOnNewPost',
}

// Post types that open their own page in the web app instead of the generic
// /posts/:id permalink (mirrors web/src/utils/routes.ts). The permalink would
// hand these on anyway; linking directly just skips the redirect.
const POST_TYPE_PATHS: Record<string, string> = {
  TRIP: 'trips',
  ALBUM: 'albums',
  GIFT_LIST: 'gift-lists',
}

// The web-app link a notification email carries, or null when the admin
// hasn't set the publicUrl setting (there is no request to derive an origin
// from here). The link only names the post — the web app still requires
// sign-in and applies the usual group/circle checks, and recipients were
// already circle-filtered by notify(), so it exposes nothing new. A signed-out
// reader lands back on it after logging in (rememberReturnPath in web/).
export function notificationLink(
  publicUrl: string,
  post: { id: string; type: string } | null,
  type: NotifyType
): string | null {
  const base = publicUrl.trim().replace(/\/+$/, '')
  if (!base) return null
  if (post) return `${base}/${POST_TYPE_PATHS[post.type] ?? 'posts'}/${encodeURIComponent(post.id)}`
  // new_media_assets is tied to an album, not a post — the Photos tab is
  // where those assets show up.
  if (type === 'new_media_assets') return `${base}/photos`
  return `${base}/`
}

// `pool` reuses up to EMAIL_MAX_CONNECTIONS SMTP connections across messages
// instead of one connection per message; a pooled transporter holds sockets
// open, so its caller must close() it when done.
export async function createTransporter(
  settings?: Awaited<ReturnType<typeof getAllSettings>>,
  options: { pool?: boolean } = {}
) {
  const resolved = settings ?? (await getAllSettings())
  if (!resolved.smtpHost || !resolved.smtpUser || !resolved.smtpPass) {
    return null
  }

  return nodemailer.createTransport({
    ...(options.pool ? { pool: true, maxConnections: EMAIL_MAX_CONNECTIONS, maxMessages: 50 } : {}),
    host: resolved.smtpHost,
    port: resolved.smtpPort || 587,
    secure: (resolved.smtpPort || 587) === 465,
    auth: {
      user: resolved.smtpUser,
      pass: resolved.smtpPass,
    },
  })
}

export const emailChannel: NotificationChannel = {
  id: 'email',

  isEnabled(settings) {
    return settings.emailNotificationsEnabled
  },

  wants(recipient: Recipient, type: NotifyType) {
    const field = EMAIL_PREF_FIELD[type]
    return field ? recipient[field] : false
  },

  async send({ type, recipients, message, settings, postId }) {
    const transporter = await createTransporter(settings, { pool: true })
    if (!transporter) return

    const t = i18n.getFixedT(settings.defaultLanguage)
    const brandName = resolveBrandSettings(settings).name
    const subject = brandName
      ? t('notifications.emailSubjectBranded', { name: brandName })
      : t('notifications.emailSubject')
    let link: string | null = null
    if (settings.publicUrl) {
      const post = postId
        ? await prisma.post.findUnique({ where: { id: postId }, select: { id: true, type: true } })
        : null
      link = notificationLink(settings.publicUrl, post, type)
    }
    const body = link
      ? t('notifications.emailBodyWithLink', { message, link })
      : t('notifications.emailBody', { message })

    // Parallel so one slow/hanging recipient doesn't serialize the rest, but
    // bounded so a large family doesn't open one SMTP connection per member.
    try {
      await mapWithConcurrency(recipients, EMAIL_MAX_CONNECTIONS, (recipient) =>
        transporter
          .sendMail({
            from: settings.smtpFrom || 'Famlin <noreply@famlin.app>',
            to: recipient.email,
            subject,
            text: body,
          })
          .catch((err) => console.error('Failed to send email', err))
      )
    } finally {
      // Release the pool's sockets; a fresh pool is built per fan-out so a
      // changed SMTP setting always takes effect on the next send.
      transporter.close?.()
    }
  },
}
