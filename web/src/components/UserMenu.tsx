import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import './UserMenu.css';

// The avatar menu (profile / API tokens / logout) — AppShell's sidebar
// footer. It used to render in the compact mobile header too, but that
// header dropped the avatar (profile has its own BottomNav tab; the menu's
// unique items live on ProfilePage), so the sidebar is its only home.
export function UserMenu({
  user,
  onProfile,
  onApiTokens,
  onLogout,
}: {
  user: User;
  onProfile: () => void;
  onApiTokens: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Read from the DOM inside event handlers rather than collecting refs
  // during render.
  function menuItems(): HTMLButtonElement[] {
    return Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = menuItems();
        if (items.length === 0) return;
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        items[(currentIndex + delta + items.length) % items.length]?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    menuItems()[0]?.focus();

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(action: () => void) {
    action();
    setOpen(false);
    triggerRef.current?.focus();
  }

  const items = [
    { key: 'profile', label: t('profile.title'), action: onProfile },
    { key: 'apiTokens', label: t('apiTokens.menuItem'), action: onApiTokens },
    { key: 'logout', label: t('common.logout'), action: onLogout },
  ];

  return (
    <div className="user-menu user-menu-sidebar" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.name}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={36} />
        <span className="user-menu-name-inline">{user.name}</span>
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu" aria-label={user.name}>
          <div className="user-menu-identity">
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="user-menu-item"
              onClick={() => pick(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
