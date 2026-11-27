import { createNavigationContainerRef } from '@react-navigation/native'

// Lets code outside any screen's own navigation prop (push-notification tap
// handlers, which can fire before any screen has mounted) still navigate.
export const navigationRef = createNavigationContainerRef<any>()

export function navigate(name: string, params?: object) {
  if (navigationRef.isReady()) {
    const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void }
    nav.navigate(name, params)
  }
}

/**
 * Notification responses can arrive before the authenticated stack replaces
 * Login. Wait for a ready navigator that actually exposes the target route,
 * then navigate once. This keeps cold-start taps out of the root/login screens
 * without importing any authenticated screen into App.tsx.
 */
export function navigateWhenReady(name: string, params?: object) {
  let unsubscribeReady: (() => void) | undefined
  let unsubscribeState: (() => void) | undefined

  const attempt = () => {
    if (!navigationRef.isReady()) return false
    const state = navigationRef.getRootState()
    if (!state?.routeNames?.includes(name)) return false
    navigate(name, params)
    unsubscribeReady?.()
    unsubscribeState?.()
    return true
  }

  if (attempt()) return
  unsubscribeReady = navigationRef.addListener('ready', attempt)
  unsubscribeState = navigationRef.addListener('state', attempt)
}
