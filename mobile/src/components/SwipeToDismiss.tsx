import React, { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  interpolate,
  Extrapolation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

// Native recognition cancels the photo's Pressable when a drag begins. Keeping
// this root inside the modal also lets Android deliver gestures to the handler.
export function SwipeToDismiss({
  children,
  disabled,
  onActiveChange,
  onClose,
  topInset = 0,
  bottomInset = 0,
}: {
  children: React.ReactNode
  disabled: boolean
  onActiveChange: (active: boolean) => void
  onClose: () => void
  topInset?: number
  bottomInset?: number
}) {
  const { height } = useWindowDimensions()
  const translation = useSharedValue(0)
  const horizontal = useSharedValue(0)
  const active = useSharedValue(false)
  const originY = useSharedValue(0)
  const originX = useSharedValue(0)
  const closing = useSharedValue(false)
  const mounted = useRef(true)

  const finishClose = useCallback(() => {
    if (mounted.current) onClose()
  }, [onClose])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelAnimation(translation)
      cancelAnimation(horizontal)
    }
  }, [translation, horizontal])

  const pan = Gesture.Pan()
    .withTestId('swipe-dismiss')
    .enabled(!disabled)
    .maxPointers(1)
    .activeOffsetY(10)
    .failOffsetY(-10)
    .failOffsetX([-20, 20])
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0]
      // Do not steal gestures from the header or reply/reaction controls.
      if (closing.get() || !touch || touch.y <= topInset || touch.y >= height - bottomInset) manager.fail()
    })
    .onStart((event) => {
      // A new drag takes over an unfinished return at its current position.
      cancelAnimation(translation)
      cancelAnimation(horizontal)
      originY.set(translation.get() - event.translationY)
      originX.set(horizontal.get() - event.translationX * 0.15)
      active.set(true)
      closing.set(false)
      runOnJS(onActiveChange)(true)
    })
    .onUpdate((event) => {
      translation.set(Math.max(0, originY.get() + event.translationY))
      horizontal.set(originX.get() + event.translationX * 0.15)
    })
    // This registers a native callback; finishClose reads its ref only after the animation.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event) => {
      const farEnough = translation.get() > Math.min(160, height * 0.22)
      // Gesture Handler reports velocity in pixels/second, unlike PanResponder.
      const flick = translation.get() > 30 && event.velocityY > 750
      if ((farEnough || flick) && event.velocityY > -300) {
        closing.set(true)
        translation.set(
          withTiming(height + 80, { duration: 200 }, (finished) => {
            if (finished) runOnJS(finishClose)()
          })
        )
      }
    })
    .onFinalize(() => {
      if (!active.get() || closing.get()) return
      const config = { duration: 180, easing: Easing.out(Easing.cubic) }
      horizontal.set(withTiming(0, config))
      translation.set(
        withTiming(0, config, (finished) => {
          if (!finished) return
          active.set(false)
          runOnJS(onActiveChange)(false)
        })
      )
    })

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translation.get(), [0, height * 0.7, height], [1, 0.1, 0], Extrapolation.CLAMP),
  }))
  const contentStyle = useAnimatedStyle(() => ({
    borderRadius: active.get() ? 24 : 0,
    transform: [
      { translateY: translation.get() },
      { translateX: horizontal.get() },
      { scale: interpolate(translation.get(), [0, height], [1, 0.85], Extrapolation.CLAMP) },
    ],
  }))

  return (
    <GestureHandlerRootView style={styles.container}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View collapsable={false} style={[styles.content, contentStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  content: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
})
