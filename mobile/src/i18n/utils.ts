import i18n from './index';

export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return i18n.t('relativeTime.justNow');
  }

  if (diffHours < 1) {
    return i18n.t('relativeTime.minutesAgo', { count: diffMinutes });
  }

  if (diffDays < 1) {
    return i18n.t('relativeTime.hoursAgo', { count: diffHours });
  }

  if (diffDays === 1) {
    return i18n.t('relativeTime.daysAgo', { count: 1 });
  }

  if (diffDays < 7) {
    return i18n.t('relativeTime.daysAgo', { count: diffDays });
  }

  return date.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
