import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Dimensions, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { getUploadUrl } from '@famlin/api-client'
import { LivePhotoIcon } from './LivePhotoIcon'
import { useExclusiveVideo } from '@/hooks/useExclusiveVideo'

function Motion({ url, onInterrupted }: { url: string; onInterrupted: () => void }) {
  const player = useVideoPlayer({ uri: getUploadUrl(url) }, (video) => {
    video.loop = true
    video.muted = true
  })
  useExclusiveVideo(player, onInterrupted)
  useEffect(() => {
    player.play()
    // useVideoPlayer releases and stops the native player on unmount.
  }, [player])
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
}

export function LivePhotoMedia({
  imageUrl,
  videoUrl,
  style,
  autoPlay = false,
  isActive = true,
}: {
  autoPlay?: boolean
  isActive?: boolean
  imageUrl: string
  videoUrl: string
  style?: StyleProp<ViewStyle>
}) {
  const { t } = useTranslation()
  const view = useRef<View>(null)
  const [visible, setVisible] = useState(false)
  const [paused, setPaused] = useState(!autoPlay)
  const interrupt = useCallback(() => setPaused(true), [])
  const focused = useIsFocused()
  useEffect(() => {
    setPaused(!autoPlay)
  }, [autoPlay, isActive, focused])
  useEffect(() => {
    const measure = () => {
      if (!focused || AppState.currentState !== 'active') {
        setVisible(false)
        setPaused(true)
        return
      }
      view.current?.measureInWindow((_x, y, width, height) => {
        const inView = width > 0 && height > 0 && y + height > 0 && y < Dimensions.get('window').height
        setVisible(inView)
        if (!inView) setPaused(true)
      })
    }
    measure()
    const interval = setInterval(measure, 500)
    const subscription = AppState.addEventListener('change', measure)
    return () => {
      clearInterval(interval)
      subscription.remove()
    }
  }, [focused])
  return (
    <View ref={view} style={style} collapsable={false}>
      <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      {visible && focused && isActive && !paused && <Motion url={videoUrl} onInterrupted={interrupt} />}
      <TouchableOpacity
        style={styles.badge}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t(paused ? 'media.playLivePhoto' : 'media.pauseLivePhoto')}
        onPress={(event) => {
          event.stopPropagation()
          setPaused((value) => !value)
        }}
      >
        <LivePhotoIcon size={20} />
      </TouchableOpacity>
    </View>
  )
}
const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    padding: 6,
  },
})
