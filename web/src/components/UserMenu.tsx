import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import './UserMenu.css';

// The avatar menu (profile / API tokens / logout) — used both by Sidebar's
// footer (wide screens) and AppShell's compact mobile header (≤720px), so
// the two variants only differ in trigger styling (full-width name row vs.
// icon-only), not behavior: opens on click, closes on Esc or an outside
// click, arrow-key navigable while open, and returns focus to the trigger
// on close.
export function UserMenu({
  user,
  variant,
  onProfile,
  onApiTokens,
  onLogout,
}: {
  user: User;
  variant: 'sidebar' | 'header';
  onProfile: () => void;
  onApiTokens: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
        const items = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
        if (items.length === 0) return;
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        items[(currentIndex + delta + items.length) % items.length]?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    itemRefs.current[0]?.focus();

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
    { key: 'profile', label: t('profile.title'), onClick: () => pick(onProfile) },
    { key: 'apiTokens', label: t('apiTokens.menuItem'), onClick: () => pick(onApiTokens) },
    { key: 'logout', label: t('common.logout'), onClick: () => pick(onLogout) },
  ];

  return (
    <div className={`user-menu user-menu-${variant}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.name}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={variant === 'sidebar' ? 36 : 40} />
        {variant === 'sidebar' && <span className="user-menu-name-inline">{user.name}</span>}
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu" aria-label={user.name}>
          <div className="user-menu-identity">
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className="user-menu-item"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
