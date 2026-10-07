import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { User, fetchChatUnreadCounts } from '@famlin/api-client';
import { BrandIcon } from '@/components/Logo';
import { useBranding } from '@/hooks/useBranding';
import { Icon, IconName } from '@/components/Icon';
import { UserMenu } from '@/components/UserMenu';
import { ApiTokensModal } from '@/components/ApiTokensModal';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { BottomNav } from '@/components/BottomNav';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import './AppShell.css';

export type NavView = 'feed' | 'photos' | 'chat' | 'profile';

// The app shell every authenticated page renders itself inside of (mirrors
// mobile's MainTabs.tsx, adapted for wide screens): a left sidebar nav rail
// on screens wider than 720px (collapsing to an icon-only rail between
// 721–1100px), or today's compact top header + BottomNav at ≤720px.
//
// Deliberately mirrors BottomNav's own prop shape (onFeed/onPhotos/onChat/
// onProfile/onNewPost, each an optional-except-the-current-tab plain
// callback) rather than inventing a `navigate(view)` abstraction — pages
// stay router-agnostic (App.tsx is the only place that knows about
// react-router, see utils/routes.ts) and this keeps every page's existing
// prop contract and tests unchanged; AppShell is a drop-in replacement for
// the sticky top header + BottomNav pair each page used to render itself.
// The avatar menu (profile / API tokens / logout), unlike before, is owned
// here rather than duplicated per page, so it works identically everywhere
// instead of only from the feed.
export function AppShell({
  user,
  active,
  onFeed,
  onPhotos,
  onChat,
  onProfile,
  onNewPost,
  onLogout,
  children,
}: {
  user: User;
  active: NavView;
  onFeed: () => void;
  onPhotos?: () => void;
  onChat?: () => void;
  onProfile: () => void;
  onNewPost?: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const branding = useBranding();
  const [apiTokensOpen, setApiTokensOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Same ['chat-unread'] cache key + `enabled: !!onChat` convention the old
  // top header/BottomNav used — skipped on ChatPage itself, which doesn't
  // pass onChat since it IS chat.
  const unreadQuery = useQuery({
    queryKey: ['chat-unread'],
    queryFn: fetchChatUnreadCounts,
    refetchInterval: 30000,
    enabled: !!onChat,
  });
  const hasUnreadChat = Object.values(unreadQuery.data ?? {}).some((count) => count > 0);

  function goTo(view: NavView) {
    if (view === 'feed') onFeed();
    else if (view === 'photos') onPhotos?.();
    else if (view === 'chat') onChat?.();
    else onProfile();
  }

  useKeyboardShortcuts({
    onNavigate: goTo,
    onNewPost,
    onHelp: () => setShortcutsOpen(true),
  });

  const brandName = branding?.name ?? t('common.appName');

  const navItems: { view: NavView; icon: IconName; label: string; keys: string; onClick?: () => void; badge?: boolean; show: boolean }[] = [
    { view: 'feed', icon: 'home', label: t('tabs.feed'), keys: 'g f', onClick: onFeed, show: true },
    { view: 'photos', icon: 'grid', label: t('tabs.photos'), keys: 'g p', onClick: onPhotos, show: !!onPhotos || active === 'photos' },
    {
      view: 'chat',
      icon: 'message-square',
      label: t('tabs.chat'),
      keys: 'g c',
      onClick: onChat,
      badge: hasUnreadChat,
      show: !!onChat || active === 'chat',
    },
    { view: 'profile', icon: 'user', label: t('tabs.profile'), keys: 'g u', onClick: onProfile, show: true },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('a11y.skipToContent')}
      </a>

      <nav className="sidebar" aria-label={brandName}>
        <div className="sidebar-brand">
          <BrandIcon size={32} />
          <span className="sidebar-wordmark">{brandName}</span>
        </div>

        <ul className="sidebar-nav">
          {navItems
            .filter((item) => item.show)
            .map((item) => (
              <li key={item.view}>
                <button
                  type="button"
                  className={`sidebar-item${active === item.view ? ' sidebar-item-active' : ''}`}
                  onClick={item.onClick ?? (() => {})}
                  aria-current={active === item.view ? 'page' : undefined}
                  aria-label={item.label}
                  title={t('shortcuts.hint', { label: item.label, keys: item.keys })}
                >
                  <Icon name={item.icon} size={20} />
                  <span className="sidebar-label">{item.label}</span>
                  {item.badge && <span className="sidebar-item-badge" aria-hidden />}
                </button>
              </li>
            ))}
        </ul>

        {onNewPost && (
          <button
            type="button"
            className="btn btn-primary sidebar-new-post"
            onClick={onNewPost}
            title={t('shortcuts.hint', { label: t('feed.newPost'), keys: 'n' })}
          >
            <Icon name="plus" size={18} color="white" strokeWidth={2.5} />
            <span className="sidebar-label">{t('feed.newPost')}</span>
          </button>
        )}

        <button
          type="button"
          className="sidebar-shortcuts-hint"
          onClick={() => setShortcutsOpen(true)}
          title={t('shortcuts.openHelp')}
        >
          <kbd className="shortcut-key">?</kbd>
          <span className="sidebar-label">{t('shortcuts.openHelp')}</span>
        </button>

        <div className="sidebar-footer">
          <UserMenu
            user={user}
            variant="sidebar"
            onProfile={onProfile}
            onApiTokens={() => setApiTokensOpen(true)}
            onLogout={onLogout}
          />
        </div>
      </nav>

      <header className="mobile-header">
        <div className="mobile-header-brand">
          <BrandIcon size={30} />
          <span className="mobile-header-wordmark">{brandName}</span>
        </div>
        <UserMenu
          user={user}
          variant="header"
          onProfile={onProfile}
          onApiTokens={() => setApiTokensOpen(true)}
          onLogout={onLogout}
        />
      </header>

      <main className="app-shell-main" id="main-content">
        {children}
      </main>

      <BottomNav
        active={active}
        onFeed={onFeed}
        onPhotos={onPhotos}
        onChat={onChat}
        onProfile={onProfile}
        onNewPost={onNewPost}
      />

      {apiTokensOpen && <ApiTokensModal onClose={() => setApiTokensOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
