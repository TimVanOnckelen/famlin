import { create } from 'zustand';
import {
  User,
  getStorageAdapter,
  TOKEN_KEY,
  setMediaToken,
  refreshMediaToken,
} from '@famlin/api-client';

// Web counterpart of mobile's authStore — smaller on purpose: no server URL
// (the web app is same-origin with the backend) and no push-token
// unregistration on logout (no web push yet).
interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setAuth: (user: User, token: string) => Promise<void>;
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
  clearSession: () => Promise<void>;
  loadToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,

  setAuth: async (user, token) => {
    await getStorageAdapter().setItem(TOKEN_KEY, token);
    set({ user, token, isLoading: false });
    await refreshMediaToken();
  },

  updateUser: (user) => {
    set({ user });
  },

  logout: async () => {
    await getStorageAdapter().removeItem(TOKEN_KEY);
    setMediaToken(null);
    set({ user: null, token: null, isLoading: false });
  },

  // A 401 from the API (expired/revoked token) — same as logout on web
  // (mobile's differs: it keeps the server URL and unregisters push), kept as
  // a separate action only to mirror mobile's store shape.
  clearSession: async () => get().logout(),

  loadToken: async () => {
    const token = await getStorageAdapter().getItem(TOKEN_KEY);
    set({ token, isLoading: false });
    return token;
  },
}));
