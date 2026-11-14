import {
  EMPTY_EVENT_DRAFT,
  buildEventTypeData,
  formatEventWhen,
  localDateTimeToIso,
  parseLocalDateTime,
  toLocalDateTime,
  validEventDraft,
  validLocalDateTime,
  withEventStart,
} from '@/utils/event'

const draft = (overrides: Partial<typeof EMPTY_EVENT_DRAFT> = {}) => ({
  ...EMPTY_EVENT_DRAFT,
  startsAt: '2026-11-14T15:00',
  ...overrides,
})

describe('local date-time strings', () => {
  it('round-trips a local wall-clock time', () => {
    const date = new Date(2026, 10, 14, 9, 5)
    expect(toLocalDateTime(date)).toBe('2026-11-14T09:05')
    expect(parseLocalDateTime('2026-11-14T09:05')).toEqual(date)
  })

  it('converts to the ISO instant of that local time', () => {
    expect(localDateTimeToIso('2026-11-14T15:00')).toBe(new Date(2026, 10, 14, 15, 0).toISOString())
  })

  it('rejects anything but the exact format', () => {
    expect(validLocalDateTime('2026-11-14T15:00')).toBe(true)
    expect(validLocalDateTime('')).toBe(false)
    expect(validLocalDateTime('2026-11-14')).toBe(false)
    expect(validLocalDateTime('2026-11-14T15:00:00Z')).toBe(false)
  })
})

describe('validEventDraft', () => {
  it('needs a start', () => {
    expect(validEventDraft(EMPTY_EVENT_DRAFT)).toBe(false)
    expect(validEventDraft(draft())).toBe(true)
  })

  it('rejects an end before the start and a deadline after it', () => {
    expect(validEventDraft(draft({ endsAt: '2026-11-14T14:59' }))).toBe(false)
    expect(validEventDraft(draft({ endsAt: '2026-11-14T15:00' }))).toBe(true)
    expect(validEventDraft(draft({ rsvpDeadline: '2026-11-14T15:01' }))).toBe(false)
    expect(validEventDraft(draft({ rsvpDeadline: '2026-11-13T12:00' }))).toBe(true)
  })
})

describe('withEventStart', () => {
  it('clears an end or deadline the new start contradicts and keeps the rest', () => {
    const before = draft({ endsAt: '2026-11-14T18:00', rsvpDeadline: '2026-11-12T12:00', location: 'Home' })
    expect(withEventStart(before, '2026-11-15T10:00')).toEqual({
      startsAt: '2026-11-15T10:00',
      endsAt: '',
      rsvpDeadline: '2026-11-12T12:00',
      location: 'Home',
    })
    expect(withEventStart(before, '2026-11-11T10:00')).toEqual({
      startsAt: '2026-11-11T10:00',
      endsAt: '2026-11-14T18:00',
      rsvpDeadline: '',
      location: 'Home',
    })
  })
})

describe('buildEventTypeData', () => {
  it('sends ISO times and leaves out empty optional fields', () => {
    expect(buildEventTypeData(draft({ location: '  ' }))).toEqual({
      startsAt: new Date(2026, 10, 14, 15, 0).toISOString(),
    })
  })

  it('includes every field that is set, with a trimmed location', () => {
    expect(
      buildEventTypeData(
        draft({ endsAt: '2026-11-14T18:00', location: " Grandma's garden ", rsvpDeadline: '2026-11-12T20:00' })
      )
    ).toEqual({
      startsAt: new Date(2026, 10, 14, 15, 0).toISOString(),
      endsAt: new Date(2026, 10, 14, 18, 0).toISOString(),
      location: "Grandma's garden",
      rsvpDeadline: new Date(2026, 10, 12, 20, 0).toISOString(),
    })
  })
})

describe('formatEventWhen', () => {
  const start = new Date(2026, 10, 14, 15, 0).toISOString()

  it('shows only the end time when the event ends the same day', () => {
    const text = formatEventWhen(start, new Date(2026, 10, 14, 18, 0).toISOString(), 'en-GB')
    expect(text).toContain('14 November 2026')
    expect(text).toMatch(/– 18:00$/)
  })

  it('shows the full end date when it ends on another day', () => {
    const text = formatEventWhen(start, new Date(2026, 10, 15, 11, 0).toISOString(), 'en-GB')
    expect(text).toContain('15 November 2026')
  })

  it('shows just the start without an end', () => {
    expect(formatEventWhen(start, null, 'en-GB')).not.toContain('–')
  })
})
