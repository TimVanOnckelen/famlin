import i18n from './index'

// Building a date formatter is slow next to using one, and the feed formats
// a date for every card it renders, so they're kept per language.
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>()

function formatShortDate(date: Date): string {
  let formatter = shortDateFormatters.get(i18n.language)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
    shortDateFormatters.set(i18n.language, formatter)
  }
  return formatter.format(date)
}

export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) {
    return i18n.t('relativeTime.justNow')
  }

  if (diffHours < 1) {
    return i18n.t('relativeTime.minutesAgo', { count: diffMinutes })
  }

  if (diffDays < 1) {
    return i18n.t('relativeTime.hoursAgo', { count: diffHours })
  }

  if (diffDays === 1) {
    return i18n.t('relativeTime.daysAgo', { count: 1 })
  }

  if (diffDays < 7) {
    return i18n.t('relativeTime.daysAgo', { count: diffDays })
  }

  return formatShortDate(date)
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
}

// "3 juli" / "3 July" — used by the trip timeline's closed (oldest-first)
// variant, which labels each entry with a date instead of a time.
//
// A plain 'YYYY-MM-DD' (trip.startDate/endDate) parses as UTC midnight; in a
// local timezone west of UTC that formats as the previous day. Anchor
// date-only strings to local midnight before parsing (same trick as
// formatTripDateRange above) so the calendar day never shifts; an ISO
// datetime (e.g. closedAt) already carries a time and parses/formats in
// local time correctly as-is.
export function formatDayMonth(dateString: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
  const date = new Date(isDateOnly ? `${dateString}T00:00:00` : dateString)
  return date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })
}

// "3 t/m 14 juli" when start/end fall in the same month, else "3 Jul to 14 Aug".
// startDate/endDate are trip typeData's plain 'YYYY-MM-DD' strings.
export function formatTripDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return i18n.t('feed.trip.dateRangeSameMonth', {
      startDay: start.getDate(),
      endDay: end.getDate(),
      month: end.toLocaleDateString(i18n.language, { month: 'long' }),
    })
  }

  return i18n.t('feed.trip.dateRangeDifferentMonth', {
    start: start.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
    end: end.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
  })
}
