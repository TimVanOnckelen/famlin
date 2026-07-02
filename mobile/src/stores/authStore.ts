import { create } from 'zustand';
import { User } from '@/types';
import { setToken, deleteToken, getToken, setServerUrl, deleteServerUrl, getPushToken, deletePushToken } from '@/utils/storage';
import { api, setApiBaseUrl, setMediaToken } from '@/api/client';
import { refreshMediaToken } from '@/api/uploads';

interface AuthState {
  user: User | null;
  token: string | null;
  serverUrl: string | null;
  isLoading: boolean;
  setAuth: (user: User, token: string, serverUrl: string) => Promise<void>;
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
  clearSession: () => Promise<void>;
  loadToken: () => Promise<string | null>;
  setServerUrl: (serverUrl: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  serverUrl: null,
  isLoading: true,

  setAuth: async (user, token, serverUrl) => {
    await setToken(token);
    await setServerUrl(serverUrl);
    setApiBaseUrl(serverUrl);
    set({ user, token, serverUrl, isLoading: false });
    await refreshMediaToken();
  },

  updateUser: (user) => {
    set({ user });
  },

  // Explicit, user-initiated sign-out — also forgets the server address and
  // unregisters this device's push token so a handed-off/shared device
  // stops receiving the previous account's notifications.
  logout: async () => {
    const pushToken = await getPushToken();
    if (pushToken) {
      await api.delete('/push-tokens', { params: { token: pushToken } }).catch(() => {});
      await deletePushToken();
    }
    await deleteToken();
    await deleteServerUrl();
    setMediaToken(null);
    set({ user: null, token: null, serverUrl: null, isLoading: false });
  },

  // A 401 from the API (expired/revoked token) — clears the session but
  // keeps the remembered server address, since the user just needs to log
  // back in on the same server, not re-enter it.
  clearSession: async () => {
    await deleteToken();
    setMediaToken(null);
    set({ user: null, token: null, isLoading: false });
  },

  loadToken: async () => {
    const token = await getToken();
    set({ token, isLoading: false });
    return token;
  },

  setServerUrl: async (serverUrl) => {
    await setServerUrl(serverUrl);
    setApiBaseUrl(serverUrl);
    set({ serverUrl });
  },
}));
