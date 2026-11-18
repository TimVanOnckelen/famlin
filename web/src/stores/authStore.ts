import { create } from 'zustand'
import { User, getStorageAdapter, TOKEN_KEY, setMediaToken, refreshMediaToken, logoutSession } from '@famlin/api-client'

// Web counterpart of mobile's authStore — smaller on purpose: no server URL
// (the web app is same-origin with the backend) and no push-token
// unregistration on logout (no web push yet).
interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  setAuth: (user: User, token: string) => Promise<void>
  updateUser: (user: User) => void
  logout: () => Promise<void>
  clearSession: () => Promise<void>
  loadToken: () => Promise<string | null>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,

  setAuth: async (user, token) => {
    await getStorageAdapter().setItem(TOKEN_KEY, token)
    set({ user, token, isLoading: false })
    await refreshMediaToken()
  },

  updateUser: (user) => {
    set({ user })
  },

  // Explicit sign-out: ends the session on the server first (best effort,
  // never throws), so the token is useless even if a copy of it survives in
  // this browser's storage.
  logout: async () => {
    await logoutSession()
    await get().clearSession()
  },

  // A 401 from the API (expired/revoked token): the server already considers
  // the session over, so only the local copy is forgotten.
  clearSession: async () => {
    await getStorageAdapter().removeItem(TOKEN_KEY)
    setMediaToken(null)
    set({ user: null, token: null, isLoading: false })
  },

  loadToken: async () => {
    const token = await getStorageAdapter().getItem(TOKEN_KEY)
    set({ token, isLoading: false })
    return token
  },
}))
