import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Navigate, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router';
import { ensureFreshMediaToken, fetchMe, setUnauthorizedHandler, User } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from '@/pages/LoginPage';
import { FeedPage } from '@/pages/FeedPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { PhotosPage } from '@/pages/PhotosPage';
import { ChatPage } from '@/pages/ChatPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { AlbumDetailPage } from '@/pages/AlbumDetailPage';
import { PostDetailPage } from '@/pages/PostDetailPage';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { useTranslation } from 'react-i18next';
import { useBranding } from '@/hooks/useBranding';
import { applyBranding } from '@/utils/branding';
import { paths, useAppNavigation } from '@/utils/routes';

export default function App() {
  const { user, setAuth, clearSession, loadToken, isLoading } = useAuthStore();
  const [initializing, setInitializing] = useState(true);
  const { t } = useTranslation();
  const branding = useBranding();
  const navigate = useNavigate();

  // Per-family branding (issue #164). The server already injected it into
  // index.html; this keeps the page in sync with /server-info afterwards.
  useEffect(() => {
    applyBranding(branding, t('common.appName'));
  }, [branding, t]);

  // A session *ending* (logout or 401) shouldn't land the next login back on
  // whatever page it ended on — e.g. the profile page. Only the transition
  // from signed-in to signed-out resets the URL: a cold load without a
  // session keeps its URL, so a shared /posts/:id link opened while logged
  // out still lands on that post after logging in.
  const previousUserRef = useRef<User | null>(null);
  useEffect(() => {
    if (previousUserRef.current && !user) {
      navigate(paths.feed, { replace: true });
    }
    previousUserRef.current = user;
  }, [user, navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
    });
  }, [clearSession]);

  // Web counterpart of mobile's AppState listener: the media token (7d TTL)
  // can go stale, or its initial fetch can simply have failed, and <img>/
  // <video> requests bypass axios's 401 handling entirely — so without this
  // every photo silently 401s for the rest of the session. Re-check whenever
  // the tab is brought back to the foreground.
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') ensureFreshMediaToken();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.id]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const token = await loadToken();
        if (token) {
          const me = await fetchMe();
          await setAuth(me, token);
        }
      } catch (err) {
        // Only an actual auth rejection should end the session — a network
        // error just means the server wasn't reachable on this load.
        if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
          await clearSession();
        }
      } finally {
        setInitializing(false);
      }
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initializing || isLoading) {
    return null;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      <ScrollToTopOnNavigate />
      <ReadOnlyBanner />
      <AppRoutes user={user} />
    </>
  );
}

// Every page was previously a view switch in this file; each one now owns a
// path (see utils/routes.ts). The pages themselves still take plain
// callbacks, so they stay router-agnostic and their tests don't need one.
function AppRoutes({ user }: { user: User }) {
  const { logout } = useAuthStore();
  const nav = useAppNavigation();

  return (
    <Routes>
      <Route
        path={paths.feed}
        element={
          <FeedPage
            user={user}
            onOpenProfile={nav.toProfile}
            onOpenPhotos={nav.toPhotos}
            onOpenChat={nav.toChat}
            onOpenTrip={nav.toTrip}
            onOpenAlbum={nav.toAlbum}
            onLogout={() => logout()}
          />
        }
      />
      <Route
        path={paths.photos}
        element={
          <PhotosPage
            user={user}
            onOpenFeed={nav.toFeed}
            onOpenChat={nav.toChat}
            onOpenProfile={nav.toProfile}
            onOpenAlbum={nav.toAlbum}
            onLogout={() => logout()}
          />
        }
      />
      <Route
        path={paths.chat}
        element={
          <ChatPage user={user} onBack={nav.toFeed} onOpenPhotos={nav.toPhotos} onOpenProfile={nav.toProfile} />
        }
      />
      <Route
        path={paths.profile}
        element={
          <ProfilePage
            user={user}
            onBack={nav.toFeed}
            onOpenPhotos={nav.toPhotos}
            onOpenChat={nav.toChat}
            onLogout={() => logout()}
          />
        }
      />
      <Route path="/trips/:postId" element={<TripRoute />} />
      <Route path="/albums/:postId" element={<AlbumRoute />} />
      <Route path="/posts/:postId" element={<PostRoute />} />
      <Route path="*" element={<Navigate to={paths.feed} replace />} />
    </Routes>
  );
}

function TripRoute() {
  const { postId } = useParams<{ postId: string }>();
  const nav = useAppNavigation();
  return (
    <TripDetailPage
      key={postId}
      postId={postId!}
      onBack={nav.back}
      onOpenFeed={nav.toFeed}
      onOpenPhotos={nav.toPhotos}
      onOpenChat={nav.toChat}
      onOpenProfile={nav.toProfile}
    />
  );
}

function AlbumRoute() {
  const { postId } = useParams<{ postId: string }>();
  const nav = useAppNavigation();
  return (
    <AlbumDetailPage
      key={postId}
      postId={postId!}
      onBack={nav.back}
      onOpenFeed={nav.toFeed}
      onOpenPhotos={nav.toPhotos}
      onOpenChat={nav.toChat}
      onOpenProfile={nav.toProfile}
    />
  );
}

function PostRoute() {
  const { postId } = useParams<{ postId: string }>();
  const nav = useAppNavigation();
  return (
    <PostDetailPage
      key={postId}
      postId={postId!}
      onBack={nav.back}
      onOpenFeed={nav.toFeed}
      onOpenTrip={(id) => nav.toTrip(id, { replace: true })}
      onOpenAlbum={(id) => nav.toAlbum(id, { replace: true })}
      onOpenPhotos={nav.toPhotos}
      onOpenChat={nav.toChat}
      onOpenProfile={nav.toProfile}
    />
  );
}

// BrowserRouter (unlike the data routers) has no <ScrollRestoration>; without
// this, opening a trip from halfway down the feed lands halfway down the trip.
// Back/forward (POP) is left alone so the browser can do its own thing.
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType]);
  return null;
}
