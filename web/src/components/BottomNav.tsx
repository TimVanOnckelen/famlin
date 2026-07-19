import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchChatUnreadCounts } from '@famlin/api-client';
import './BottomNav.css';

type BottomNavTab = 'feed' | 'photos' | 'chat' | 'profile';

// The app-like bottom tab bar shown on small screens (see BottomNav.css's
// media query) — mirrors mobile's MainTabs.tsx: Feed/Photos/Chat/Profile
// tabs plus a floating "+" FAB, shown only when the current page owns a
// composer to open (Feed and Photos, same as mobile's FAB_TABS).
export function BottomNav({
  active,
  onFeed,
  onPhotos,
  onChat,
  onProfile,
  onNewPost,
}: {
  active: BottomNavTab;
  onFeed: () => void;
  onPhotos?: () => void;
  onChat?: () => void;
  onProfile: () => void;
  onNewPost?: () => void;
}) {
  const { t } = useTranslation();

  // Same ['chat-unread'] cache entry AppHeader polls — sharing the key means
  // this doesn't add a second network poll on top of AppHeader's own.
  const unreadQuery = useQuery({
    queryKey: ['chat-unread'],
    queryFn: fetchChatUnreadCounts,
    refetchInterval: 30000,
    enabled: !!onChat,
  });
  const hasUnreadChat = Object.values(unreadQuery.data ?? {}).some((count) => count > 0);

  return (
    <nav className="bottom-nav" aria-label={t('common.appName')}>
      <button
        className={`bottom-nav-item${active === 'feed' ? ' bottom-nav-item-active' : ''}`}
        onClick={onFeed}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 12L12 3l9 9M5 10v10h5v-6h4v6h5V10"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t('tabs.feed')}</span>
      </button>

      {(onPhotos || active === 'photos') && (
        <button
          className={`bottom-nav-item${active === 'photos' ? ' bottom-nav-item-active' : ''}`}
          onClick={onPhotos ?? (() => {})}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <rect x="14" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <rect x="14" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <rect x="3" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <span>{t('tabs.photos')}</span>
        </button>
      )}

      {(onChat || active === 'chat') && (
        <button
          className={`bottom-nav-item${active === 'chat' ? ' bottom-nav-item-active' : ''}`}
          onClick={onChat ?? (() => {})}
        >
          <span className="bottom-nav-icon-wrap">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {hasUnreadChat && <span className="bottom-nav-badge" aria-hidden />}
          </span>
          <span>{t('tabs.chat')}</span>
        </button>
      )}

      <button
        className={`bottom-nav-item${active === 'profile' ? ' bottom-nav-item-active' : ''}`}
        onClick={onProfile}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t('tabs.profile')}</span>
      </button>

      {onNewPost && (
        <button
          className="bottom-nav-fab"
          onClick={onNewPost}
          aria-label={t('feed.newPost')}
          title={t('feed.newPost')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </nav>
  );
}
