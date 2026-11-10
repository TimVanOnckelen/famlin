import { formatEventWhen, localInputToIso, validLocalInput } from '@/utils/event'

// Built from local times, so these hold in whatever time zone the tests run.
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('formatEventWhen', () => {
  it('shows just the start when there is no end', () => {
    const text = formatEventWhen(local(2026, 11, 14, 15), null, 'en-GB')
    expect(text).toContain('Saturday')
    expect(text).toContain('14 November 2026')
    expect(text).toContain('15:00')
    expect(text).not.toContain('–')
  })

  it('shows only the end time when the event ends the same day', () => {
    const text = formatEventWhen(local(2026, 11, 14, 15), local(2026, 11, 14, 18), 'en-GB')
    expect(text).toMatch(/ – 18:00$/)
    expect(text.match(/November/g)).toHaveLength(1)
  })

  it('shows the full end date when the event runs past midnight', () => {
    const text = formatEventWhen(local(2026, 11, 14, 20), local(2026, 11, 15, 2), 'en-GB')
    expect(text).toContain('14 November 2026')
    expect(text).toContain('15 November 2026')
  })
})

describe('datetime-local conversion', () => {
  it('reads a local input value as local time', () => {
    expect(localInputToIso('2026-12-24T18:00')).toBe(local(2026, 12, 24, 18))
  })

  it('accepts only complete datetime-local values', () => {
    expect(validLocalInput('2026-12-24T18:00')).toBe(true)
    expect(validLocalInput('2026-12-24')).toBe(false)
    expect(validLocalInput('')).toBe(false)
    expect(validLocalInput('2026-13-40T99:00')).toBe(false)
  })
})
