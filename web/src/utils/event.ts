// "Saturday, 14 November 2026, 15:00 – 18:00" — an event's when-line. The end
// shows only its time when it falls on the same local day as the start, and
// the full date otherwise.
export function formatEventWhen(startsAt: string, endsAt: string | null, locale: string): string {
  const start = new Date(startsAt)
  const full: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' }
  const startText = start.toLocaleString(locale, full)
  if (!endsAt) return startText
  const end = new Date(endsAt)
  const endText =
    end.toDateString() === start.toDateString()
      ? end.toLocaleTimeString(locale, { timeStyle: 'short' })
      : end.toLocaleString(locale, full)
  return `${startText} – ${endText}`
}

// "14 Nov, 12:00" — the compact form used for the RSVP deadline.
export function formatEventDeadline(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// <input type="datetime-local"> works in the browser's local time with no
// offset ('2026-11-14T15:00'); this converts one to the ISO instant the
// server stores.
export function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

export function validLocalInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}
