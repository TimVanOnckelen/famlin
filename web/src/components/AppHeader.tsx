import { useTranslation } from 'react-i18next';
import { User } from '@famlin/api-client';
import { AppIcon } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import './AppHeader.css';

export function AppHeader({
  user,
  onNewPost,
  onProfile,
  onPhotos,
  onApiTokens,
  onLogout,
}: {
  user: User;
  onNewPost: () => void;
  onProfile: () => void;
  onPhotos?: () => void;
  onApiTokens: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-brand">
          <AppIcon size={40} />
          <span className="app-header-wordmark">{t('common.appName')}</span>
        </div>

        <div className="app-header-actions">
          <button className="btn btn-primary btn-new-post" onClick={onNewPost}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
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
