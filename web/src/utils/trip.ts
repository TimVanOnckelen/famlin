import type { TFunction } from 'i18next';
import { Comment } from '@famlin/api-client';

// Web's own copy of mobile's src/utils/trip.ts (day-number derivation +
// comment splitting/sorting) — same contract, kept independent per package
// since mobile and web don't share non-api-client code.

// Splits a 'YYYY-MM-DD' (or an ISO datetime's date portion) into
// [year, monthIndex, day] for Date.UTC.
function parseISODateParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return [y, (m || 1) - 1, d || 1];
}

// Derives a check-in's day number from the trip's startDate — day 1 =
// startDate itself, counting whole UTC calendar days (not 24h periods), per
// the backend contract ("Day numbers: derive client-side from startDate,
// UTC date diff + 1"). Clamped to a minimum of 1 (mirrors the backend's
// Math.max(1, ...) in services/postTypes/trip.ts) since a check-in can land
// on a UTC calendar day before startDate for a traveler east of UTC
// checking in shortly after local midnight on the trip's first day.
export function computeTripDayNumber(startDate: string, atIso: string): number {
  const start = Date.UTC(...parseISODateParts(startDate));
  const at = Date.UTC(...parseISODateParts(atIso));
  const diffDays = Math.round((at - start) / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays + 1);
}

export interface TripCheckinEntry {
  comment: Comment;
  dayNumber: number;
  replies: Comment[];
}

export interface SplitTripComments {
  // Top-level check-ins (metadata.kind === 'trip_checkin'), each carrying
  // its own reply thread — the vertical timeline.
  checkins: TripCheckinEntry[];
  // Top-level comments that are NOT check-ins — the "Reacties op de reis"
  // section, separate from the per-check-in threads.
  tripComments: Comment[];
  // Every comment's replies, keyed by parentId.
  repliesByParent: Map<string, Comment[]>;
}

// Splits a post's flat comment list into the trip timeline vs. the
// trip-level comment section. A reply is identified by its parentId, not by
// whether it happens to carry check-in metadata (it never does — only the
// check-in itself does) — so this checks parentId first: any comment with
// one is always a reply attached to its parent, never promoted to a
// top-level bucket of its own.
export function splitTripComments(comments: Comment[], startDate: string): SplitTripComments {
  const repliesByParent = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const list = repliesByParent.get(comment.parentId) || [];
    list.push(comment);
    repliesByParent.set(comment.parentId, list);
  }

  const checkins: TripCheckinEntry[] = comments
    .filter((c) => !c.parentId && c.metadata?.kind === 'trip_checkin')
    .map((comment) => ({
      comment,
      dayNumber: computeTripDayNumber(startDate, comment.createdAt),
      replies: repliesByParent.get(comment.id) || [],
    }));

  const tripComments = comments.filter((c) => !c.parentId && !c.metadata);

  return { checkins, tripComments, repliesByParent };
}

// Newest-first while the trip is active, oldest-first once closed (labeled
// "Dagboek · oudste eerst" in the detail view).
export function sortCheckins(checkins: TripCheckinEntry[], newestFirst: boolean): TripCheckinEntry[] {
  const sorted = [...checkins].sort(
    (a, b) => new Date(a.comment.createdAt).getTime() - new Date(b.comment.createdAt).getTime()
  );
  return newestFirst ? sorted.reverse() : sorted;
}

// "3 juli t/m 14 juli" when start/end fall in the same month, else
// "3 jul tot 14 aug" — startDate/endDate are the trip's plain 'YYYY-MM-DD'
// typeData strings. Takes `t`/`locale` explicitly (mirrors formatRelativeDate
// in utils/time.ts) rather than importing an i18n singleton, so it stays a
// plain, testable function.
export function formatTripDateRange(t: TFunction, locale: string, startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return t('feed.trip.dateRangeSameMonth', {
      startDay: start.getDate(),
      endDay: end.getDate(),
      month: end.toLocaleDateString(locale, { month: 'long' }),
    });
  }

  return t('feed.trip.dateRangeDifferentMonth', {
    start: start.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
    end: end.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
  });
}
