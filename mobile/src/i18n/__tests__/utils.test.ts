import { formatRelativeDate, formatDateTime } from '@/i18n/utils';

const NOW = new Date('2024-06-15T12:00:00.000Z');

function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60 * 1000).toISOString();
}

function hoursAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60 * 60 * 1000).toISOString();
}

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('i18n/utils', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('formatRelativeDate', () => {
    it('says "just now" for anything under a minute old', () => {
      expect(formatRelativeDate(minutesAgo(0))).toBe('just now');
    });

    it('pluralizes minutes correctly', () => {
      expect(formatRelativeDate(minutesAgo(1))).toBe('1 minute ago');
      expect(formatRelativeDate(minutesAgo(5))).toBe('5 minutes ago');
    });

    it('pluralizes hours correctly', () => {
      expect(formatRelativeDate(hoursAgo(1))).toBe('1 hour ago');
      expect(formatRelativeDate(hoursAgo(3))).toBe('3 hours ago');
    });

    it('says "yesterday" for exactly one day ago', () => {
      expect(formatRelativeDate(daysAgo(1))).toBe('yesterday');
    });

    it('pluralizes days correctly under a week', () => {
      expect(formatRelativeDate(daysAgo(3))).toBe('3 days ago');
    });

    it('falls back to a localized date once 7+ days have passed', () => {
      const dateString = daysAgo(10);
      const expected = new Date(dateString).toLocaleDateString('en', { day: 'numeric', month: 'short' });
      expect(formatRelativeDate(dateString)).toBe(expected);
    });
  });

  describe('formatDateTime', () => {
    it('formats with day, short month, hour and minute', () => {
      const dateString = daysAgo(2);
      const expected = new Date(dateString).toLocaleDateString('en', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(formatDateTime(dateString)).toBe(expected);
    });
  });
});
