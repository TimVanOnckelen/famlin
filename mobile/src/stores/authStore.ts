import { create } from 'zustand';
import { User } from '@/types';
import { setToken, deleteToken, getToken } from '@/utils/storage';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setAuth: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  loadToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  setAuth: async (user, token) => {
    await setToken(token);
    set({ user, token, isLoading: false });
  },

  logout: async () => {
    await deleteToken();
    set({ user: null, token: null, isLoading: false });
  },

  loadToken: async () => {
    const token = await getToken();
    set({ token, isLoading: false });
    return token;
  },
}));
