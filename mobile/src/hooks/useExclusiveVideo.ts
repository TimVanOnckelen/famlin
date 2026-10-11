import { useLayoutEffect } from 'react'
import type { VideoPlayer } from 'expo-video'

const players = new Map<VideoPlayer, (() => void) | undefined>()

export function useExclusiveVideo(player: VideoPlayer, onInterrupted?: () => void) {
  useLayoutEffect(() => {
    players.set(player, onInterrupted)
    const subscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (!isPlaying) return
      for (const [other, interrupt] of players) {
        if (other !== player) {
          other.pause()
          interrupt?.()
        }
      }
    })
    return () => {
      subscription.remove()
      players.delete(player)
    }
  }, [player, onInterrupted])
}
