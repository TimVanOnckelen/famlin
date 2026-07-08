import { useEffect, useState } from 'react';
import axios from 'axios';
import { fetchMe, setUnauthorizedHandler } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from '@/pages/LoginPage';
import { FeedPage } from '@/pages/FeedPage';
import { ProfilePage } from '@/pages/ProfilePage';

export default function App() {
  const { user, setAuth, clearSession, loadToken, isLoading, logout } = useAuthStore();
  const [initializing, setInitializing] = useState(true);
  // No client-side routing yet — the profile page is a simple view switch.
  const [view, setView] = useState<'feed' | 'profile'>('feed');

  // A session ending on the profile view (logout or 401) shouldn't land the
  // next login on the profile page.
  useEffect(() => {
    if (!user) setView('feed');
  }, [user]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
    });
  }, [clearSession]);

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
    return <ProfilePage user={user} onBack={() => setView('feed')} onLogout={() => logout()} />;
  }

  return <FeedPage user={user} onOpenProfile={() => setView('profile')} onLogout={() => logout()} />;
}
