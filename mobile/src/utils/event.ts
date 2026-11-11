import type { EventCreateData } from '@famlin/api-client'

// The composer keeps event times as local wall-clock strings
// ('2026-11-14T15:00', the same shape web's <input type="datetime-local">
// uses), so the start/end/deadline rules compare them as plain strings and a
// draft never shifts with the device's time zone. They're turned into ISO
// instants only when the post is sent.
const LOCAL_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export interface EventDraft {
  startsAt: string
  endsAt: string
  location: string
  rsvpDeadline: string
}

export const EMPTY_EVENT_DRAFT: EventDraft = { startsAt: '', endsAt: '', location: '', rsvpDeadline: '' }

const pad = (value: number) => String(value).padStart(2, '0')

export function toLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Parsed component by component rather than with `new Date(value)`, whose
// handling of an offset-less ISO string has differed between JS engines.
export function parseLocalDateTime(value: string): Date {
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes] = timePart.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

export function validLocalDateTime(value: string): boolean {
  return LOCAL_DATE_TIME_REGEX.test(value) && !Number.isNaN(parseLocalDateTime(value).getTime())
}

export function localDateTimeToIso(value: string): string {
  return parseLocalDateTime(value).toISOString()
}

// True when the draft is complete enough to publish: a start, and an end and
// RSVP deadline that, when set, agree with it — the same rules the server
// enforces (errors.eventEndsBeforeStart, errors.eventDeadlineAfterStart).
export function validEventDraft(event: EventDraft): boolean {
  return (
    validLocalDateTime(event.startsAt) &&
    (!event.endsAt || (validLocalDateTime(event.endsAt) && event.endsAt >= event.startsAt)) &&
    (!event.rsvpDeadline || (validLocalDateTime(event.rsvpDeadline) && event.rsvpDeadline <= event.startsAt))
  )
}

// A new start drops an end or reply-by it now contradicts, rather than
// leaving the composer with a draft it can't publish.
export function withEventStart(event: EventDraft, startsAt: string): EventDraft {
  return {
    ...event,
    startsAt,
    endsAt: event.endsAt && event.endsAt < startsAt ? '' : event.endsAt,
    rsvpDeadline: event.rsvpDeadline && event.rsvpDeadline > startsAt ? '' : event.rsvpDeadline,
  }
}

// The createPost typeData, with empty optional fields left out.
export function buildEventTypeData(event: EventDraft): EventCreateData {
  const location = event.location.trim()
  return {
    startsAt: localDateTimeToIso(event.startsAt),
    ...(event.endsAt ? { endsAt: localDateTimeToIso(event.endsAt) } : {}),
    ...(location ? { location } : {}),
    ...(event.rsvpDeadline ? { rsvpDeadline: localDateTimeToIso(event.rsvpDeadline) } : {}),
  }
}

const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}
const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

// "Saturday 14 November 2026, 15:00 – 18:00" — an event's when-line. The end
// shows only its time when it falls on the same local day as the start, and
// the full date otherwise (mirrors web/src/utils/event.ts).
export function formatEventWhen(startsAt: string, endsAt: string | null, locale: string): string {
  const start = new Date(startsAt)
  const startText = start.toLocaleString(locale, FULL_DATE_TIME)
  if (!endsAt) return startText
  const end = new Date(endsAt)
  const endText =
    end.toDateString() === start.toDateString()
      ? end.toLocaleTimeString(locale, TIME_ONLY)
      : end.toLocaleString(locale, FULL_DATE_TIME)
  return `${startText} – ${endText}`
}

// "14 Nov, 12:00" — the compact form used for the RSVP deadline.
export function formatEventDeadline(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', ...TIME_ONLY })
}
