import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { User, fetchChatUnreadCounts } from '@famlin/api-client';
import { AppIcon } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import './AppHeader.css';

export function AppHeader({
  user,
  onNewPost,
  onProfile,
  onPhotos,
  onChat,
  onApiTokens,
  onLogout,
}: {
  user: User;
  onNewPost: () => void;
  onProfile: () => void;
  onPhotos?: () => void;
  onChat?: () => void;
  onApiTokens: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();

  // Owned here (rather than threaded down from the feed/photos pages) so the
  // unread dot works from either page without extra prop-drilling — every
  // AppHeader instance polls the same ['chat-unread'] cache entry. Only
  // fetched when the chat icon is actually shown.
  const unreadQuery = useQuery({
    queryKey: ['chat-unread'],
    queryFn: fetchChatUnreadCounts,
    refetchInterval: 30000,
    enabled: !!onChat,
  });
  const hasUnreadChat = Object.values(unreadQuery.data ?? {}).some((count) => count > 0);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-brand">
          <AppIcon size={40} />
          <span className="app-header-wordmark">{t('common.appName')}</span>
        </div>

        <div className="app-header-actions">
          {onChat && (
            <button
              className="header-icon-btn"
              onClick={onChat}
              aria-label={t('chat.title')}
              title={t('chat.title')}
            >
              <Icon name="message-square" size={20} />
              {hasUnreadChat && <span className="header-icon-badge" aria-hidden />}
            </button>
          )}

          <button className="btn btn-primary btn-new-post" onClick={onNewPost}>
            <Icon name="plus" size={18} color="white" strokeWidth={2.5} />
            {t('feed.newPost')}
          </button>

          <details className="user-menu">
            <summary className="user-menu-trigger" aria-label={user.name}>
              <Avatar name={user.name} avatarUrl={user.avatarUrl} size={40} />
            </summary>
            <div className="user-menu-dropdown">
              <div className="user-menu-identity">
                <div className="user-menu-name">{user.name}</div>
                <div className="user-menu-email">{user.email}</div>
              </div>
              <button className="user-menu-item" onClick={onProfile}>
                {t('profile.title')}
              </button>
              {onPhotos && (
                <button className="user-menu-item" onClick={onPhotos}>
                  {t('photos.title')}
                </button>
              )}
              <button className="user-menu-item" onClick={onApiTokens}>
                {t('apiTokens.menuItem')}
              </button>
              <button className="user-menu-item" onClick={onLogout}>
                {t('common.logout')}
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
