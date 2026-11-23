import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import './BottomNav.css'

type BottomNavTab =
  'feed' | 'photos' | 'chat' | 'favorites' | 'notifications' | 'search' | 'wiki' | 'profile' | 'members'

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
  chatUnread = false,
}: {
  active: BottomNavTab
  onFeed: () => void
  onPhotos?: () => void
  onChat?: () => void
  onProfile: () => void
  onNewPost?: () => void
  chatUnread?: boolean
}) {
  const { t } = useTranslation()

  return (
    <nav className="bottom-nav" aria-label={t('common.appName')}>
      <button
        className={`bottom-nav-item${active === 'feed' ? ' bottom-nav-item-active' : ''}`}
        onClick={onFeed}
        aria-current={active === 'feed' ? 'page' : undefined}
      >
        <Icon name="home" size={22} />
        <span>{t('tabs.feed')}</span>
      </button>

      {(onPhotos || active === 'photos') && (
        <button
          className={`bottom-nav-item${active === 'photos' ? ' bottom-nav-item-active' : ''}`}
          onClick={onPhotos ?? (() => {})}
          aria-current={active === 'photos' ? 'page' : undefined}
        >
          <Icon name="grid" size={22} />
          <span>{t('tabs.photos')}</span>
        </button>
      )}

      {(onChat || active === 'chat') && (
        <button
          className={`bottom-nav-item${active === 'chat' ? ' bottom-nav-item-active' : ''}`}
          onClick={onChat ?? (() => {})}
          aria-current={active === 'chat' ? 'page' : undefined}
        >
          <span className="bottom-nav-icon-wrap">
            <Icon name="message-square" size={22} />
            {chatUnread && <span className="bottom-nav-badge" aria-hidden />}
          </span>
          <span>{t('tabs.chat')}</span>
        </button>
      )}

      <button
        className={`bottom-nav-item${active === 'profile' ? ' bottom-nav-item-active' : ''}`}
        onClick={onProfile}
        aria-current={active === 'profile' ? 'page' : undefined}
      >
        <Icon name="user" size={22} />
        <span>{t('tabs.profile')}</span>
      </button>

      {onNewPost && (
        <button className="bottom-nav-fab" onClick={onNewPost} aria-label={t('feed.newPost')} title={t('feed.newPost')}>
          <Icon name="plus" size={24} color="white" strokeWidth={2.5} />
        </button>
      )}
    </nav>
  )
}
