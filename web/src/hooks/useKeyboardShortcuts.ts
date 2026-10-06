import { useEffect, useRef } from 'react';
import type { NavView } from '@/components/AppShell';

export interface KeyboardShortcutHandlers {
  onNavigate: (view: NavView) => void;
  // Omitted entirely on a page with no composer (Chat/Profile) — mirrors
  // BottomNav/Sidebar's own onNewPost?: () => void convention.
  onNewPost?: () => void;
  onHelp: () => void;
}

const NAV_KEYS: Record<string, NavView> = { f: 'feed', p: 'photos', c: 'chat', u: 'profile' };

// Global "g then <letter>" / "n" / "?" shortcuts (the Gmail/Linear-style
// chord pattern). Ignored while typing in a field or contenteditable, while
// any modal is open (every modal in this app shares the `.modal-overlay`
// convention — see NewPostModal.tsx et al.), or while a modifier key is
// held, so this never steals a browser/OS shortcut or interferes with
// normal typing. Handlers are read through a ref so the listener is attached
// exactly once per mount regardless of how often the caller's props change.
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function resetChord() {
      pendingG = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (document.querySelector('.modal-overlay')) return;

      if (pendingG) {
        const next = NAV_KEYS[e.key];
        resetChord();
        if (next) handlersRef.current.onNavigate(next);
        return;
      }

      if (e.key === 'g') {
        pendingG = true;
        timer = setTimeout(resetChord, 1000);
        return;
      }

      if (e.key === 'n' && handlersRef.current.onNewPost) {
        handlersRef.current.onNewPost();
        return;
      }

      if (e.key === '?') {
        handlersRef.current.onHelp();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      resetChord();
    };
  }, []);
}
