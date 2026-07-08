import { useEffect, useState } from 'react';
import axios from 'axios';
import { fetchMe, setUnauthorizedHandler } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from '@/pages/LoginPage';
import { FeedPage } from '@/pages/FeedPage';

export default function App() {
  const { user, setAuth, clearSession, loadToken, isLoading, logout } = useAuthStore();
  const [initializing, setInitializing] = useState(true);

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

  return user ? <FeedPage user={user} onLogout={() => logout()} /> : <LoginPage />;
}
