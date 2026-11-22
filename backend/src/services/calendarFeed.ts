import { createHash, randomBytes } from 'crypto'
import { prisma } from '../db.js'
import i18n from '../i18n/index.js'
import { getAllSettings } from './settings.js'
import { getBrandName } from './branding/index.js'
import { visiblePostsWhereFor } from './circles.js'
import { getUserGroupIds } from './groups.js'

// Personal iCal subscription feed of family events (issue #499):
// GET /api/calendar/<token>/famlin.ics (routes/calendar.ts), managed from
// /api/auth/me/calendar-feed (routes/auth.ts).
//
// The token in the URL is the only credential — calendar apps can't send an
// Authorization header — so it is a 256-bit secret, stored only as a SHA-256
// hash, and it unlocks nothing but this one read-only feed. One per user;
// regenerating replaces the row. Like a PAT it is independent of
// User.tokenVersion: a password reset doesn't break calendar subscriptions.
export const CALENDAR_FEED_TOKEN_PREFIX = 'famlin_cal_'

// `famlin_cal_` + base64url of 32 random bytes (43 chars, no padding).
const CALENDAR_FEED_TOKEN_RE = /^famlin_cal_[A-Za-z0-9_-]{43}$/

// lastUsedAt is informational ("is a calendar app still subscribed?"), so,
// like ApiToken.lastUsedAt, it's written at most this often.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000

// Events that started up to this long ago stay in the feed (plus every
// future event), so a calendar app keeps recent history without the feed
// growing forever.
export const CALENDAR_FEED_PAST_MONTHS = 3

// Safety cap on one feed's size. A family generating more events than this
// inside the window is far beyond normal use; the newest-created ones win.
export const CALENDAR_FEED_MAX_EVENTS = 1000

// Events with no end time are shown as one hour long.
const DEFAULT_EVENT_DURATION_MS = 60 * 60_000

export function hashCalendarFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateCalendarFeedToken() {
  const token = `${CALENDAR_FEED_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  return { token, tokenHash: hashCalendarFeedToken(token) }
}

// Resolves a feed token to its owner's user id, or null when it's malformed,
// unknown or revoked (row deleted / replaced by a regenerate).
export async function resolveCalendarFeedToken(token: string): Promise<string | null> {
  if (!CALENDAR_FEED_TOKEN_RE.test(token)) return null

  const record = await prisma.calendarFeedToken.findUnique({
    where: { tokenHash: hashCalendarFeedToken(token) },
    select: { id: true, userId: true, lastUsedAt: true },
  })
  if (!record) return null

  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Fire-and-forget: usage tracking must never fail or slow the feed.
    prisma.calendarFeedToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  return record.userId
}

// The subscription URLs for a token under a public origin (no trailing slash).
export function calendarFeedUrls(origin: string, token: string) {
  const url = `${origin}/api/calendar/${token}/famlin.ics`
  return { url, webcalUrl: url.replace(/^https?:\/\//i, 'webcal://') }
}

// ---------------------------------------------------------------------------
// RFC 5545 helpers (pure, unit-tested in tests/calendar-feed.test.ts)
// ---------------------------------------------------------------------------

// TEXT value escaping (RFC 5545 §3.3.11): backslash, semicolon and comma are
// backslash-escaped, line breaks become a literal `\n`. Other control
// characters aren't allowed in a TEXT value at all and are dropped.
export function escapeIcalText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  )
}

// Content-line folding (RFC 5545 §3.1): lines longer than 75 octets are split
// with CRLF + one space, counting UTF-8 bytes and never splitting a
// multi-byte character. The leading space of a continuation line counts
// toward its 75 octets.
export function foldIcalLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line
  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  let limit = 75
  for (const char of line) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (currentBytes + bytes > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
      limit = 74
    }
    current += char
    currentBytes += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

// UTC DATE-TIME form: YYYYMMDDTHHMMSSZ.
export function formatIcalDate(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

interface EventTypeData {
  startsAt: string
  endsAt: string | null
  location: string | null
}

function readEventTypeData(value: unknown): EventTypeData | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (typeof data.startsAt !== 'string' || Number.isNaN(new Date(data.startsAt).getTime())) return null
  return {
    startsAt: data.startsAt,
    endsAt: typeof data.endsAt === 'string' && !Number.isNaN(new Date(data.endsAt).getTime()) ? data.endsAt : null,
    location: typeof data.location === 'string' && data.location.trim() ? data.location : null,
  }
}

export interface CalendarFeedContext {
  // The publicUrl setting's origin when set, else the request's.
  origin: string
  // Whether `origin` came from the publicUrl setting — post links are only
  // included then, the same rule as notification emails.
  hasPublicUrl: boolean
}

export function calendarFeedCutoff(now = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CALENDAR_FEED_PAST_MONTHS)
  return cutoff
}

// Builds the subscriber's whole feed, recomputed from what they can see right
// now: removed from a family or circle means the event is gone next fetch.
export async function buildCalendarFeed(userId: string, context: CalendarFeedContext): Promise<string> {
  const settings = await getAllSettings()
  const t = i18n.getFixedT(settings.defaultLanguage)
  const calendarName = (await getBrandName()) ?? 'Famlin'
  const uidHost = new URL(context.origin).hostname

  const groupIds = await getUserGroupIds(userId)
  const posts = groupIds.length
    ? await prisma.post.findMany({
        where: {
          AND: [
            // THE post visibility predicate (group + circle narrowing).
            await visiblePostsWhereFor(groupIds, userId),
            { type: 'EVENT' },
            // A JSON-path filter in the database rather than in JS: the
            // window is the whole point of the bound, and an event's
            // createdAt says nothing about when it takes place. startsAt is
            // always stored by eventHandler.transformCreate as a UTC
            // toISOString() value, so a string comparison is chronological.
            { typeData: { path: ['startsAt'], gte: calendarFeedCutoff().toISOString() } },
          ],
        },
        select: {
          id: true,
          crossPostId: true,
          content: true,
          typeData: true,
          createdAt: true,
          editedAt: true,
          groupId: true,
          group: { select: { name: true } },
          author: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: CALENDAR_FEED_MAX_EVENTS,
      })
    : []

  // One VEVENT per cross-post: every copy the subscriber can see is merged.
  // The representative copy is the one in the family whose name sorts first
  // (then by ids), so the choice is stable between fetches.
  type Row = (typeof posts)[number]
  const byEvent = new Map<string, Row[]>()
  for (const post of posts) {
    const key = post.crossPostId ?? post.id
    const list = byEvent.get(key)
    if (list) list.push(post)
    else byEvent.set(key, [post])
  }
  for (const list of byEvent.values()) {
    list.sort(
      (a, b) =>
        a.group.name.localeCompare(b.group.name) || a.groupId.localeCompare(b.groupId) || a.id.localeCompare(b.id)
    )
  }

  // The subscriber's own RSVP, wherever they left it: on any sibling copy of
  // a cross-posted event, the same rule as the event's `myRsvp`
  // (services/postTypes/event.ts enrichPosts).
  const crossPostIds = [...new Set(posts.map((p) => p.crossPostId).filter((id): id is string => !!id))]
  const siblings = crossPostIds.length
    ? await prisma.post.findMany({
        where: { crossPostId: { in: crossPostIds } },
        select: { id: true, crossPostId: true },
      })
    : []
  const eventKeyByPostId = new Map<string, string>()
  for (const post of posts) eventKeyByPostId.set(post.id, post.crossPostId ?? post.id)
  for (const sibling of siblings) eventKeyByPostId.set(sibling.id, sibling.crossPostId!)

  const rsvps = eventKeyByPostId.size
    ? await prisma.postInteraction.findMany({
        where: { userId, key: 'rsvp', postId: { in: [...eventKeyByPostId.keys()] } },
        select: { postId: true, value: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const rsvpByEvent = new Map<string, string>()
  for (const rsvp of rsvps) {
    const key = eventKeyByPostId.get(rsvp.postId)
    if (key && typeof rsvp.value === 'string') rsvpByEvent.set(key, rsvp.value)
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Famlin//Family events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]

  for (const [eventKey, copies] of byEvent) {
    const post = copies[0]
    const typeData = readEventTypeData(post.typeData)
    if (!typeData) continue

    const start = new Date(typeData.startsAt)
    const end = typeData.endsAt ? new Date(typeData.endsAt) : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS)
    const modified = copies.reduce<Date>((latest, copy) => {
      const at = copy.editedAt ?? copy.createdAt
      return at > latest ? at : latest
    }, post.editedAt ?? post.createdAt)
    const rsvp = rsvpByEvent.get(eventKey)

    // Only what the feed's own subscriber already sees on the event card —
    // never comments or photos, since a calendar app may sync it elsewhere.
    const familyNames = [...new Set(copies.map((copy) => copy.group.name))].join(', ')
    const description = [
      t('calendarFeed.family', { name: familyNames }),
      t('calendarFeed.postedBy', { name: post.author.name }),
    ]
    if (rsvp === 'yes') description.push(t('calendarFeed.rsvpYes'))
    else if (rsvp === 'maybe') description.push(t('calendarFeed.rsvpMaybe'))
    else if (rsvp === 'no') description.push(t('calendarFeed.rsvpNo'))
    const link = context.hasPublicUrl ? `${context.origin}/posts/${encodeURIComponent(post.id)}` : null
    if (link) description.push(t('calendarFeed.openInFamlin', { url: link }))

    lines.push(
      'BEGIN:VEVENT',
      // Stable across edits and identical for every cross-post copy.
      `UID:${eventKey}@${uidHost}`,
      `DTSTAMP:${formatIcalDate(modified)}`,
      `CREATED:${formatIcalDate(post.createdAt)}`,
      `LAST-MODIFIED:${formatIcalDate(modified)}`,
      `DTSTART:${formatIcalDate(start)}`,
      `DTEND:${formatIcalDate(end < start ? start : end)}`,
      `SUMMARY:${escapeIcalText(post.content?.trim() || '')}`
    )
    if (typeData.location) lines.push(`LOCATION:${escapeIcalText(typeData.location)}`)
    lines.push(`DESCRIPTION:${escapeIcalText(description.join('\n'))}`)
    if (rsvp === 'yes') lines.push('STATUS:CONFIRMED')
    else if (rsvp === 'maybe') lines.push('STATUS:TENTATIVE')
    if (link) lines.push(`URL:${link}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldIcalLine).join('\r\n') + '\r\n'
}
