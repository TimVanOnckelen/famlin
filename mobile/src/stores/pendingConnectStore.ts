import { create } from 'zustand'

interface PendingConnectState {
  /** Server origin from a `famlin://connect` link, waiting for the login screen (or, when signed in, App) to act on it. */
  server: string | null
  setServer: (server: string) => void
  clear: () => void
}

// A store rather than navigation params: the link can arrive before the login
// screen is mounted (cold start) or while it already is.
export const usePendingConnectStore = create<PendingConnectState>((set) => ({
  server: null,
  setServer: (server) => set({ server }),
  clear: () => set({ server: null }),
}))
