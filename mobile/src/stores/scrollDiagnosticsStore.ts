import { create } from 'zustand'

interface ScrollDiagnosticsState {
  /** Whether the feed scroll diagnostics bar is switched on (issue #357). */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

// Switched on from Profile → Advanced, in every build. In memory only on
// purpose: it's for one measuring session, so a restart switches it off and
// nobody is left with a stray bar above their feed.
export const useScrollDiagnosticsStore = create<ScrollDiagnosticsState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}))
