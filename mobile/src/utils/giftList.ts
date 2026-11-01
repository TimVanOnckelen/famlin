// "5 December" — a gift list's occasion date is a plain YYYY-MM-DD, which
// parses as UTC midnight (the previous day west of UTC), so it gets a local
// midnight time appended first. Same trick as utils/trip.ts.
export function formatDayMonth(date: string, locale: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

// http(s) only — mirrors the server's validation of a wish's shop link.
export function isValidShopUrl(url: string): boolean {
  return !url.trim() || /^https?:\/\/\S+$/i.test(url.trim())
}
