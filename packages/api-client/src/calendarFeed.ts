import { api } from './client'

// Personal iCal subscription feed of the member's EVENT posts (issue #499).
// One feed per member, across every family they belong to. The server only
// stores a hash of the secret, so the subscription URL is returned exactly
// once — by createCalendarFeed() — and can never be read back afterwards.
export interface CalendarFeedStatus {
  /** Whether the member currently has a feed URL (an active token). */
  enabled: boolean
  createdAt: string | null
  /** Last time a calendar app fetched the feed; throttled server-side. */
  lastUsedAt: string | null
}

export interface CreatedCalendarFeed {
  /** `https://…/api/calendar/<token>/famlin.ics` — shown once. */
  url: string
  /** The same URL with the `webcal://` scheme, for one-tap subscribe. */
  webcalUrl: string
  createdAt: string
}

export async function fetchCalendarFeed(): Promise<CalendarFeedStatus> {
  const res = await api.get<CalendarFeedStatus>('/auth/me/calendar-feed')
  return res.data
}

// Creates the feed, or regenerates it: the previous URL stops working.
export async function createCalendarFeed(): Promise<CreatedCalendarFeed> {
  const res = await api.post<CreatedCalendarFeed>('/auth/me/calendar-feed')
  return res.data
}

export async function revokeCalendarFeed(): Promise<void> {
  await api.delete('/auth/me/calendar-feed')
}
