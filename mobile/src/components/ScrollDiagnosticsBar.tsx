import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native'
import { sendDiagnosticReport } from '@famlin/api-client'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'
import Constants from 'expo-constants'
import * as Device from 'expo-device'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { useServerFeatureSupport, useServerInfo } from '@/hooks/useServerInfo'
import { useScrollDiagnosticsStore } from '@/stores/scrollDiagnosticsStore'
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

type SendState = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * The feed scroll diagnostics (issue #357): record a scroll, get the
 * dropped-frame numbers for the UI and JS threads, then send the report to
 * this server's admin or share it as text. Nothing leaves the phone unless
 * the member presses one of those. Only mounted while the diagnostics are
 * switched on (Profile → Advanced), so the frame counter below costs nothing
 * in normal use.
 */
export function ScrollDiagnosticsBar({ posts }: { posts: Post[] }) {
  const { t } = useTranslation()
  const { data: serverInfo } = useServerInfo()
  const [recording, setRecording] = useState(false)
  const [report, setReport] = useState<ScrollReport | null>(null)
  const [sendState, setSendState] = useState<SendState>('idle')
  const canSendToAdmin = useServerFeatureSupport('diagnosticReports') === 'supported'
  const switchOff = useScrollDiagnosticsStore((s) => s.setEnabled)

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
    setSendState('idle')
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

  async function sendToAdmin() {
    if (!report || sendState === 'sending' || sendState === 'sent') return
    setSendState('sending')
    try {
      await sendDiagnosticReport({
        kind: 'feed_scroll',
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        appVersion: Constants.expoConfig?.version ?? '?',
        text: formatScrollReport(report),
        data: report,
      })
      setSendState('sent')
    } catch {
      setSendState('failed')
    }
  }

  // Switching off unmounts the bar, and the unmount cleanup above stops a
  // recording in progress.
  function close() {
    switchOff(false)
  }

  const sendLabel = {
    idle: 'scrollDiagnostics.sendToAdmin',
    sending: 'scrollDiagnostics.sending',
    sent: 'scrollDiagnostics.sent',
    failed: 'scrollDiagnostics.sendFailed',
  }[sendState]

  return (
    <View style={styles.container}>
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
        <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={recording ? stop : start}>
          <Text style={[styles.buttonText, styles.primaryButtonText]}>
            {t(recording ? 'scrollDiagnostics.stop' : 'scrollDiagnostics.start')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('scrollDiagnostics.close')}
          hitSlop={8}
        >
          <Icon name="x" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      {!recording && report && (
        <View style={styles.actions}>
          {canSendToAdmin && (
            <TouchableOpacity
              style={[styles.button, sendState === 'sent' && styles.buttonDone]}
              onPress={() => void sendToAdmin()}
              disabled={sendState === 'sending' || sendState === 'sent'}
            >
              <Text style={styles.buttonText}>{t(sendLabel)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={() => void Share.share({ message: formatScrollReport(report) })}
          >
            <Text style={styles.buttonText}>{t('scrollDiagnostics.share')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  closeButton: { padding: 4 },
  buttonDone: { opacity: 0.6 },
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
