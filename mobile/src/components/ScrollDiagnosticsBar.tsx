import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'
import Constants from 'expo-constants'
import * as Device from 'expo-device'

import { colors } from '@/constants/colors'
import { useServerInfo } from '@/hooks/useServerInfo'
import { Post } from '@/types'
import {
  estimateFrameIntervalMs,
  formatScrollReport,
  rateHitches,
  summarizeContent,
  summarizeFrames,
  ScrollRating,
  ScrollReport,
} from '@/utils/scrollDiagnostics'
import { MAX_RECORDED_FRAMES, startScrollRecording, stopScrollRecording } from '@/utils/scrollRecorder'

const RATING_COLORS: Record<ScrollRating, string> = {
  good: colors.primary,
  warning: colors.milestoneText,
  critical: colors.danger,
}

/**
 * The hidden feed scroll diagnostics (issue #357): record a scroll, get the
 * dropped-frame numbers for the UI and JS threads, share them as text. Only
 * mounted while the diagnostics are switched on from the profile screen, so
 * the frame counter below costs nothing in normal use.
 */
export function ScrollDiagnosticsBar({ posts }: { posts: Post[] }) {
  const { t } = useTranslation()
  const { data: serverInfo } = useServerInfo()
  const [recording, setRecording] = useState(false)
  const [report, setReport] = useState<ScrollReport | null>(null)

  // UI-thread frame durations, collected by a worklet so a busy JS thread
  // can't hide a stall — the JS thread keeps its own count in scrollRecorder.
  const uiFrames = useSharedValue<number[]>([])
  const scrolling = useSharedValue(false)
  const frameCallback = useFrameCallback((frame) => {
    const elapsed = frame.timeSincePreviousFrame
    if (!scrolling.get() || elapsed === null) return
    uiFrames.modify((frames) => {
      'worklet'
      if (frames.length < MAX_RECORDED_FRAMES) frames.push(elapsed)
      return frames
    })
  }, false)

  // Leaving the feed mid-recording must not leave the recorder running.
  useEffect(() => () => void stopScrollRecording(), [])

  function start() {
    uiFrames.set([])
    setReport(null)
    startScrollRecording((isScrolling) => {
      scrolling.set(isScrolling)
    })
    frameCallback.setActive(true)
    setRecording(true)
  }

  function stop() {
    frameCallback.setActive(false)
    const result = stopScrollRecording()
    setRecording(false)
    if (!result) return

    const uiDurations = uiFrames.get()
    const frameIntervalMs = estimateFrameIntervalMs(uiDurations)
    const seen = new Set(result.seenPostIds)
    setReport({
      device: Device.modelName ?? t('common.unknown'),
      os: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? Platform.Version}`,
      app: `${Constants.expoConfig?.version ?? '?'} (${Constants.nativeBuildVersion ?? '?'})`,
      server: serverInfo?.version ?? '?',
      refreshHz: Math.round(1000 / frameIntervalMs),
      ui: summarizeFrames(uiDurations, frameIntervalMs),
      js: summarizeFrames(result.jsFrames, frameIntervalMs),
      content: summarizeContent(posts.filter((post) => seen.has(post.id))),
      imageLoads: result.imageLoads,
    })
  }

  return (
    <View style={styles.bar}>
      <View style={styles.text}>
        <Text style={styles.title}>{t('scrollDiagnostics.title')}</Text>
        {recording ? (
          <Text style={styles.detail}>{t('scrollDiagnostics.recording')}</Text>
        ) : report ? (
          <>
            <Text style={[styles.detail, { color: RATING_COLORS[rateHitches(report.ui.hitchMsPerSecond)] }]}>
              {t('scrollDiagnostics.uiResult', {
                hitches: report.ui.hitchMsPerSecond.toFixed(1),
                dropped: report.ui.droppedFrames,
              })}
            </Text>
            <Text style={[styles.detail, { color: RATING_COLORS[rateHitches(report.js.hitchMsPerSecond)] }]}>
              {t('scrollDiagnostics.jsResult', {
                hitches: report.js.hitchMsPerSecond.toFixed(1),
                dropped: report.js.droppedFrames,
              })}
            </Text>
          </>
        ) : (
          <Text style={styles.detail}>{t('scrollDiagnostics.hint')}</Text>
        )}
      </View>
      {!recording && report && (
        <TouchableOpacity
          style={styles.button}
          onPress={() => void Share.share({ message: formatScrollReport(report) })}
        >
          <Text style={styles.buttonText}>{t('scrollDiagnostics.share')}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={recording ? stop : start}>
        <Text style={[styles.buttonText, styles.primaryButtonText]}>
          {t(recording ? 'scrollDiagnostics.stop' : 'scrollDiagnostics.start')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: { flex: 1 },
  title: { fontSize: 13, fontWeight: '600', color: colors.textTitle },
  detail: { fontSize: 12, color: colors.textMuted },
  button: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { fontSize: 13, fontWeight: '600', color: colors.textTitle },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  primaryButtonText: { color: colors.white },
})
