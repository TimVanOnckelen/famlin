import { RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Traps Tab/Shift+Tab focus within a modal's own content container, closes
// it on Escape, focuses its first focusable element on open, and restores
// focus to whatever had it before the modal opened. Apply the returned ref
// to the modal's content element (the one carrying role="dialog"), not the
// overlay backdrop — NewPostModal.tsx and ShortcutsDialog.tsx are the
// reference usages.
export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      return Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    const focusable = getFocusable();
    (focusable[0] ?? container).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // Deliberately only re-runs on `active` — containerRef/onClose identity
    // changes shouldn't re-trigger the initial-focus/restore-focus dance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
