import { create } from 'zustand'

/**
 * Whether this build carries the feed scroll diagnostics at all (issue #357).
 * Development builds do, and so does any build made with
 * EXPO_PUBLIC_SCROLL_DIAGNOSTICS=1 — mobile/eas.json sets it on every profile
 * except `production` and `apk`, so the builds that reach the stores and the
 * release page never expose it.
 */
export function isScrollDiagnosticsBuild(dev: boolean, flag: string | undefined): boolean {
  return dev || flag === '1'
}

// Expo inlines EXPO_PUBLIC_* at bundle time, so this has to stay a literal
// `process.env.EXPO_PUBLIC_…` read.
export const SCROLL_DIAGNOSTICS_AVAILABLE = isScrollDiagnosticsBuild(
  __DEV__,
  process.env.EXPO_PUBLIC_SCROLL_DIAGNOSTICS
)

interface ScrollDiagnosticsState {
  /** Whether the hidden feed scroll diagnostics bar is switched on. */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

// In memory only: a tester switches it on from the profile screen for one
// measuring session, and a restart is the reset. The build check sits in the
// setter, so nothing in a store build can ever switch it on.
export const useScrollDiagnosticsStore = create<ScrollDiagnosticsState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled: enabled && SCROLL_DIAGNOSTICS_AVAILABLE }),
}))
