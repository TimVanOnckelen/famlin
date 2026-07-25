import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchChatUnreadCounts } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
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
        <Icon name="home" size={22} />
        <span>{t('tabs.feed')}</span>
      </button>

      {(onPhotos || active === 'photos') && (
        <button
          className={`bottom-nav-item${active === 'photos' ? ' bottom-nav-item-active' : ''}`}
          onClick={onPhotos ?? (() => {})}
        >
          <Icon name="grid" size={22} />
          <span>{t('tabs.photos')}</span>
        </button>
      )}

      {(onChat || active === 'chat') && (
        <button
          className={`bottom-nav-item${active === 'chat' ? ' bottom-nav-item-active' : ''}`}
          onClick={onChat ?? (() => {})}
        >
          <span className="bottom-nav-icon-wrap">
            <Icon name="message-square" size={22} />
            {hasUnreadChat && <span className="bottom-nav-badge" aria-hidden />}
          </span>
          <span>{t('tabs.chat')}</span>
        </button>
      )}

      <button
        className={`bottom-nav-item${active === 'profile' ? ' bottom-nav-item-active' : ''}`}
        onClick={onProfile}
      >
        <Icon name="user" size={22} />
        <span>{t('tabs.profile')}</span>
      </button>

      {onNewPost && (
        <button
          className="bottom-nav-fab"
          onClick={onNewPost}
          aria-label={t('feed.newPost')}
          title={t('feed.newPost')}
        >
          <Icon name="plus" size={24} color="white" strokeWidth={2.5} />
        </button>
      )}
    </nav>
  );
}
