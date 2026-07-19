// Relative time for post/comment timestamps ("2 hours ago"), localized via
// Intl. Falls back to a plain localized date once it's more than a week old —
// "43 days ago" reads worse than the actual date.
export function formatRelativeDate(iso: string, locale: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (minutes < 1) return rtf.format(0, 'minute');
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days <= 7) return rtf.format(-days, 'day');
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

// "14:20" — the trip timeline's active (newest-first) variant labels each
// check-in with a time instead of a date.
export function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// "3 juli" / "3 July" — the trip timeline's closed (oldest-first) variant,
// which labels each entry with a date instead of a time.
export function formatDayMonth(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}
