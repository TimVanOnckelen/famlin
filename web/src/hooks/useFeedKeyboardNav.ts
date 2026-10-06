import { useEffect, useLayoutEffect, useRef } from 'react';
import { SHORTCUTS } from './shortcuts';

// Phase 2's feed-only shortcuts, registered at module load so the "?" help
// dialog picks them up with no change needed in shortcuts.ts itself (see the
// comment there).
SHORTCUTS.push(
  { keys: ['j'], labelKey: 'shortcuts.nextPost' },
  { keys: ['k'], labelKey: 'shortcuts.prevPost' },
  { keys: ['o'], labelKey: 'shortcuts.openPost' },
  { keys: ['l'], labelKey: 'shortcuts.likePost' },
  { keys: ['f'], labelKey: 'shortcuts.favoritePost' }
);

// Gmail/Linear-style list navigation for the feed: j/k move focus between
// post cards (registered via the returned `registerCard`), o or Enter opens
// the focused post (or its trip/album page — the caller's onOpen decides),
// l toggles a LOVE reaction, f toggles favorite. "Focused" is real DOM focus
// (document.activeElement), not separate state — so Tab lands on the same
// cards j/k do, and whichever is now focused is what o/l/f act on.
//
// Same guards as useKeyboardShortcuts: ignored while typing in a field, while
// any modal is open (every modal shares the `.modal-overlay` class), or
// while a modifier key is held.
export function useFeedKeyboardNav({
  postIds,
  onOpen,
  onLike,
  onFavorite,
}: {
  postIds: string[];
  onOpen: (postId: string) => void;
  onLike: (postId: string) => void;
  onFavorite: (postId: string) => void;
}) {
  const cardsRef = useRef(new Map<string, HTMLElement>());
  const postIdsRef = useRef(postIds);
  const handlersRef = useRef({ onOpen, onLike, onFavorite });
  useLayoutEffect(() => {
    postIdsRef.current = postIds;
    handlersRef.current = { onOpen, onLike, onFavorite };
  });

  function registerCard(id: string, el: HTMLElement | null) {
    if (el) cardsRef.current.set(id, el);
    else cardsRef.current.delete(id);
  }

  useEffect(() => {
    function focusedPostId(): string | null {
      const active = document.activeElement;
      for (const [id, el] of cardsRef.current) {
        if (el === active) return id;
      }
      return null;
    }

    function focusCard(id: string) {
      const el = cardsRef.current.get(id);
      if (!el) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.focus({ preventScroll: true });
      // jsdom (unit tests) has no scrollIntoView implementation at all.
      el.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (document.querySelector('.modal-overlay')) return;

      const ids = postIdsRef.current;
      if (ids.length === 0) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key !== 'j' && key !== 'k' && key !== 'o' && key !== 'l' && key !== 'f' && e.key !== 'Enter') return;

      const currentId = focusedPostId();
      const currentIndex = currentId ? ids.indexOf(currentId) : -1;

      if (key === 'j') {
        e.preventDefault();
        focusCard(ids[Math.min(currentIndex + 1, ids.length - 1)] ?? ids[0]);
      } else if (key === 'k') {
        if (currentIndex <= 0) return;
        e.preventDefault();
        focusCard(ids[currentIndex - 1]);
      } else if ((key === 'o' || e.key === 'Enter') && currentId) {
        e.preventDefault();
        handlersRef.current.onOpen(currentId);
      } else if (key === 'l' && currentId) {
        e.preventDefault();
        handlersRef.current.onLike(currentId);
      } else if (key === 'f' && currentId) {
        e.preventDefault();
        handlersRef.current.onFavorite(currentId);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { registerCard };
}
