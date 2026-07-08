import { formatRelativeDate } from '@/utils/time';

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats recent timestamps as relative time', () => {
    expect(formatRelativeDate('2026-07-08T11:59:40Z', 'en')).toBe('this minute');
    expect(formatRelativeDate('2026-07-08T11:30:00Z', 'en')).toBe('30 minutes ago');
    expect(formatRelativeDate('2026-07-08T09:00:00Z', 'en')).toBe('3 hours ago');
    expect(formatRelativeDate('2026-07-06T12:00:00Z', 'en')).toBe('2 days ago');
  });

  it('falls back to an absolute date after a week', () => {
    expect(formatRelativeDate('2026-05-01T12:00:00Z', 'en')).toBe('May 1, 2026');
  });

  it('localizes to the given locale', () => {
    expect(formatRelativeDate('2026-07-08T09:00:00Z', 'nl')).toBe('3 uur geleden');
  });
});
