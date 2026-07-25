import { useEffect, useState } from 'react';
import axios from 'axios';
import { ensureFreshMediaToken, fetchMe, setUnauthorizedHandler } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from '@/pages/LoginPage';
import { FeedPage } from '@/pages/FeedPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { PhotosPage } from '@/pages/PhotosPage';
import { ChatPage } from '@/pages/ChatPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { AlbumDetailPage } from '@/pages/AlbumDetailPage';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';

export default function App() {
  const { user, setAuth, clearSession, loadToken, isLoading, logout } = useAuthStore();
  const [initializing, setInitializing] = useState(true);
  // No client-side routing yet — the profile, photos, chat, and trip-detail
  // pages are simple view switches.
  const [view, setView] = useState<'feed' | 'profile' | 'photos' | 'chat' | 'trip' | 'album'>('feed');
  // Only meaningful while view === 'trip' — which post's trip is open.
  const [tripPostId, setTripPostId] = useState<string | null>(null);
  // Only meaningful while view === 'album' — which post's album is open.
  const [albumPostId, setAlbumPostId] = useState<string | null>(null);

  // A session ending on the profile view (logout or 401) shouldn't land the
  // next login on the profile page.
  useEffect(() => {
    if (!user) {
      setView('feed');
      setTripPostId(null);
      setAlbumPostId(null);
    }
  }, [user]);

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

  if (view === 'profile') {
    return (
      <>
        <ReadOnlyBanner />
        <ProfilePage
          user={user}
          onBack={() => setView('feed')}
          onOpenPhotos={() => setView('photos')}
          onOpenChat={() => setView('chat')}
          onLogout={() => logout()}
        />
      </>
    );
  }

  if (view === 'photos') {
    return (
      <>
        <ReadOnlyBanner />
        <PhotosPage
          user={user}
          onOpenFeed={() => setView('feed')}
          onOpenChat={() => setView('chat')}
          onOpenProfile={() => setView('profile')}
          onLogout={() => logout()}
        />
      </>
    );
  }

  if (view === 'chat') {
    return (
      <>
        <ReadOnlyBanner />
        <ChatPage
          user={user}
          onBack={() => setView('feed')}
          onOpenPhotos={() => setView('photos')}
          onOpenProfile={() => setView('profile')}
        />
      </>
    );
  }

  if (view === 'trip' && tripPostId) {
    return (
      <>
        <ReadOnlyBanner />
        <TripDetailPage
          postId={tripPostId}
          onBack={() => setView('feed')}
          onOpenPhotos={() => setView('photos')}
          onOpenChat={() => setView('chat')}
          onOpenProfile={() => setView('profile')}
        />
      </>
    );
  }

  if (view === 'album' && albumPostId) {
    return (
      <>
        <ReadOnlyBanner />
        <AlbumDetailPage
          postId={albumPostId}
          onBack={() => setView('feed')}
          onOpenPhotos={() => setView('photos')}
          onOpenChat={() => setView('chat')}
          onOpenProfile={() => setView('profile')}
        />
      </>
    );
  }

  return (
    <>
      <ReadOnlyBanner />
      <FeedPage
        user={user}
        onOpenProfile={() => setView('profile')}
        onOpenPhotos={() => setView('photos')}
        onOpenChat={() => setView('chat')}
        onOpenTrip={(postId) => {
          setTripPostId(postId);
          setView('trip');
        }}
        onOpenAlbum={(postId) => {
          setAlbumPostId(postId);
          setView('album');
        }}
        onLogout={() => logout()}
      />
    </>
  );
}
