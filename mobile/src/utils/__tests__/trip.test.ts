import { computeTripDayNumber, splitTripComments, sortCheckins, TripCheckinEntry } from '@/utils/trip';
import { Comment } from '@/types';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    postId: 'post-1',
    authorId: 'u1',
    author: { id: 'u1', name: 'Emma' },
    content: '',
    createdAt: '2026-07-03T10:00:00.000Z',
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    ...overrides,
  };
}

describe('computeTripDayNumber', () => {
  it('returns day 1 for the start date itself', () => {
    expect(computeTripDayNumber('2026-07-03', '2026-07-03T09:00:00.000Z')).toBe(1);
  });

  it('counts whole UTC calendar days, not 24h periods', () => {
    // Just after midnight UTC the next day is still day 2, even though less
    // than 24h has elapsed since a late-evening check-in the day before.
    expect(computeTripDayNumber('2026-07-03', '2026-07-04T00:05:00.000Z')).toBe(2);
  });

  it('handles a check-in several days after the start', () => {
    expect(computeTripDayNumber('2026-07-03', '2026-07-14T14:20:00.000Z')).toBe(12);
  });
});

describe('splitTripComments', () => {
  const startDate = '2026-07-03';

  it('buckets top-level check-ins into the timeline with a derived day number', () => {
    const checkin = makeComment({
      id: 'ci-1',
      createdAt: '2026-07-06T14:20:00.000Z',
      metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [] },
    });
    const { checkins, tripComments } = splitTripComments([checkin], startDate);

    expect(checkins).toHaveLength(1);
    expect(checkins[0].dayNumber).toBe(4);
    expect(checkins[0].comment.id).toBe('ci-1');
    expect(tripComments).toHaveLength(0);
  });

  it('buckets top-level non-check-in comments into the trip-level comments section', () => {
    const comment = makeComment({ id: 'com-1', content: 'Have a great trip!' });
    const { checkins, tripComments } = splitTripComments([comment], startDate);

    expect(checkins).toHaveLength(0);
    expect(tripComments).toEqual([comment]);
  });

  it('attaches a reply to a check-in as part of that check-in entry, not the trip-level section', () => {
    const checkin = makeComment({
      id: 'ci-1',
      createdAt: '2026-07-06T14:20:00.000Z',
      metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [] },
    });
    const reply = makeComment({ id: 'reply-1', parentId: 'ci-1', content: 'Looks amazing!' });
    const { checkins, tripComments } = splitTripComments([checkin, reply], startDate);

    expect(checkins).toHaveLength(1);
    expect(checkins[0].replies).toEqual([reply]);
    expect(tripComments).toHaveLength(0);
  });

  it('attaches a reply to a trip-level comment without promoting it to a top-level check-in', () => {
    const comment = makeComment({ id: 'com-1', content: 'Have a great trip!' });
    const reply = makeComment({ id: 'reply-1', parentId: 'com-1', content: 'Thanks!' });
    const { checkins, tripComments, repliesByParent } = splitTripComments([comment, reply], startDate);

    expect(checkins).toHaveLength(0);
    expect(tripComments).toEqual([comment]);
    expect(repliesByParent.get('com-1')).toEqual([reply]);
  });
});

describe('sortCheckins', () => {
  function entry(id: string, createdAt: string): TripCheckinEntry {
    return { comment: makeComment({ id, createdAt }), dayNumber: 1, replies: [] };
  }

  it('sorts oldest first when newestFirst is false', () => {
    const entries = [entry('b', '2026-07-05T00:00:00Z'), entry('a', '2026-07-03T00:00:00Z')];
    expect(sortCheckins(entries, false).map((e) => e.comment.id)).toEqual(['a', 'b']);
  });

  it('sorts newest first when newestFirst is true', () => {
    const entries = [entry('a', '2026-07-03T00:00:00Z'), entry('b', '2026-07-05T00:00:00Z')];
    expect(sortCheckins(entries, true).map((e) => e.comment.id)).toEqual(['b', 'a']);
  });
});
