import { useMemo } from 'react';
import { useNavigate } from 'react-router';

// The web app's URL map (issue #124). The backend's not-found handler already
// serves index.html for every GET outside /api, /uploads and /admin, so any of
// these can be opened, refreshed or shared directly.
export const paths = {
  feed: '/',
  photos: '/photos',
  chat: '/chat',
  profile: '/profile',
  trip: (postId: string) => `/trips/${encodeURIComponent(postId)}`,
  album: (postId: string) => `/albums/${encodeURIComponent(postId)}`,
  post: (postId: string) => `/posts/${encodeURIComponent(postId)}`,
} as const;

// True when the previous history entry belongs to this app session, so
// navigate(-1) stays inside the app. react-router's BrowserRouter keeps an
// `idx` in history.state that starts at 0 for the entry the app was loaded
// on and survives `replace` navigations (e.g. the post-login redirect), which
// location.key does not.
function canGoBackInApp(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

// The callbacks App.tsx hands to every page. `back` is a real browser back
// when there's somewhere in-app to go back to (so an album opened from the
// Photos tab returns there, and one opened from the feed returns to the
// feed), and the feed otherwise — e.g. a pasted /trips/:id link.
export function useAppNavigation() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      toFeed: () => navigate(paths.feed),
      toPhotos: () => navigate(paths.photos),
      toChat: () => navigate(paths.chat),
      toProfile: () => navigate(paths.profile),
      toTrip: (postId: string, opts?: { replace?: boolean }) => navigate(paths.trip(postId), opts),
      toAlbum: (postId: string, opts?: { replace?: boolean }) => navigate(paths.album(postId), opts),
      back: () => {
        if (canGoBackInApp()) navigate(-1);
        else navigate(paths.feed, { replace: true });
      },
    }),
    [navigate]
  );
}

const RETURN_TO_KEY = 'famlin.web.returnTo';

// Only same-app paths — never a scheme or a protocol-relative "//host".
function isSafeReturnPath(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

// The OIDC redirect_uri is always the app root (it has to match what's
// registered at the provider), so a deep link opened while logged out is
// stashed here before leaving for the provider and restored afterwards.
export function rememberReturnPath(path: string) {
  try {
    if (isSafeReturnPath(path) && path !== paths.feed) sessionStorage.setItem(RETURN_TO_KEY, path);
    else sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // Storage blocked — the user just lands on the feed instead.
  }
}

export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return isSafeReturnPath(path) ? path : null;
  } catch {
    return null;
  }
}
