import { useEffect, type RefObject } from 'react'

// Native controls and programmatic playback use the same browser play event.
export function useExclusiveVideo(ref: RefObject<HTMLVideoElement | null>, onInterrupted?: () => void) {
  useEffect(() => {
    const mountedVideo = ref.current
    const onPlay = (event: Event) => {
      const video = ref.current
      if (video && event.target instanceof HTMLVideoElement && event.target !== video) {
        video.pause()
        onInterrupted?.()
      }
    }
    document.addEventListener('play', onPlay, true)
    return () => {
      document.removeEventListener('play', onPlay, true)
      mountedVideo?.pause()
    }
  }, [ref, onInterrupted])
}
