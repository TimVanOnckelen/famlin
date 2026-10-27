import { useEffect } from 'react'
import { useShareIntent } from 'expo-share-intent'

import { navigate, navigationRef } from '@/navigation/navigationRef'
import { usePendingShareStore } from '@/stores/pendingShareStore'
import { receiveSharedFiles } from '@/utils/receiveShare'

/**
 * Receives photos/videos shared into Famlin from the OS share sheet (issue
 * #199) — on a cold start from a share as well as while the app is already
 * running — and queues them in the pending-share store, copied into the app's
 * cache. Text and links are out of scope and ignored.
 */
export function useReceiveShareIntents() {
  // resetOnBackground off: the share is reset by hand below once it's been
  // copied, and must not vanish if the app is backgrounded mid-copy.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: false })
  const addShare = usePendingShareStore((state) => state.addShare)

  useEffect(() => {
    if (!hasShareIntent) return
    const files = shareIntent.files ?? []
    if (files.length === 0) {
      resetShareIntent()
      return
    }
    let cancelled = false
    receiveSharedFiles(files)
      .then((share) => {
        if (!cancelled && (share.items.length > 0 || share.unsupported > 0 || share.tooLong > 0)) addShare(share)
      })
      .catch((err) => console.warn('Could not receive shared files:', err))
      .finally(() => resetShareIntent())
    return () => {
      cancelled = true
    }
  }, [hasShareIntent, shareIntent])
}

/**
 * Opens the new-post composer once a share is pending and the signed-in
 * navigator is up: right away when already logged in, otherwise after the
 * login detour. Only navigates by route name — never imports the screen, so
 * App.tsx keeps every authenticated screen behind AuthenticatedScreens.tsx
 * (the mobile branding gotcha). An already open composer just takes the
 * share from the store itself (NewPostScreen).
 */
export function useOpenComposerForShares(signedIn: boolean) {
  const hasShare = usePendingShareStore((state) => state.share !== null)

  useEffect(() => {
    if (!signedIn || !hasShare) return

    function openComposer() {
      if (!navigationRef.isReady()) return
      const state = navigationRef.getRootState()
      // The navigator still lists the Login screen for a render or two after
      // sign-in; wait for the authenticated routes.
      if (!state?.routeNames?.includes('NewPost')) return
      if (navigationRef.getCurrentRoute()?.name === 'NewPost') return
      navigate('NewPost')
    }

    openComposer()
    // Covers the container (re)mounting after the branding spinner, and the
    // routes switching over after login — both land after this effect ran.
    const unsubscribeReady = navigationRef.addListener('ready', openComposer)
    const unsubscribeState = navigationRef.addListener('state', openComposer)
    return () => {
      unsubscribeReady()
      unsubscribeState()
    }
  }, [signedIn, hasShare])
}
