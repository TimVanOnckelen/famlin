import { Comment } from '@/types';

// Splits a 'YYYY-MM-DD' (or an ISO datetime's date portion) into
// [year, monthIndex, day] for Date.UTC.
function parseISODateParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return [y, (m || 1) - 1, d || 1];
}

// Derives a check-in's day number from the trip's startDate — day 1 =
// startDate itself, counting whole UTC calendar days (not 24h periods), per
// the backend contract ("Day numbers: derive client-side from startDate,
// UTC date diff + 1").
export function computeTripDayNumber(startDate: string, atIso: string): number {
  const start = Date.UTC(...parseISODateParts(startDate));
  const at = Date.UTC(...parseISODateParts(atIso));
  const diffDays = Math.round((at - start) / (24 * 60 * 60 * 1000));
  return diffDays + 1;
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
  // Top-level comments that are NOT check-ins — the collapsed "reacties op
  // de reis" section, separate from the per-check-in threads.
  tripComments: Comment[];
  // Every comment's replies, keyed by parentId — reused so a reply's own
  // reply list lookup doesn't need to re-scan the full list.
  repliesByParent: Map<string, Comment[]>;
}

// Splits a post's flat comment list (see Comment.metadata on the shared
// Comment type) into the trip timeline vs. the trip-level comment section.
// A reply is identified by its parentId, not by whether it happens to carry
// check-in metadata (it never does — only the check-in itself does) — so
// this checks parentId first: any comment with one is always a reply
// attached to its parent (a check-in's own thread, or a nested reply under a
// trip-level comment), never promoted to a top-level bucket of its own.
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

// Newest-first while the trip is active (design 6c), oldest-first once
// closed (design 6d, labeled "Dagboek · oudste eerst").
export function sortCheckins(checkins: TripCheckinEntry[], newestFirst: boolean): TripCheckinEntry[] {
  const sorted = [...checkins].sort(
    (a, b) => new Date(a.comment.createdAt).getTime() - new Date(b.comment.createdAt).getTime()
  );
  return newestFirst ? sorted.reverse() : sorted;
}
