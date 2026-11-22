import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Linking, Share } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  createCalendarFeed,
  fetchCalendarFeed,
  revokeCalendarFeed,
  type CalendarFeedStatus,
  type CreatedCalendarFeed,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { useServerFeatureSupport } from '@/hooks/useServerInfo'
import { formatDateTime } from '@/i18n/utils'
import { profileSectionStyles } from '@/components/profileSectionStyles'

export const CALENDAR_FEED_QUERY_KEY = ['calendar-feed'] as const

// "Calendar subscription" on the profile (issue #499): a personal iCal feed
// of the member's EVENT posts across all their families. The server keeps
// only a hash of the secret, so the URL is shown exactly once, right after
// it's created or regenerated. `calendarFeed` postdates the server feature
// list, so a server that doesn't advertise it lacks it: the section is shown
// only once server-info says 'supported'.
export function CalendarFeedSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const supported = useServerFeatureSupport('calendarFeed') === 'supported'
  // Only in component state, never in the query cache: leaving the screen
  // forgets it, as it can't be read back from the server either.
  const [created, setCreated] = useState<CreatedCalendarFeed | null>(null)

  const { data: status, isLoading } = useQuery({
    queryKey: CALENDAR_FEED_QUERY_KEY,
    queryFn: fetchCalendarFeed,
    enabled: supported,
  })

  const showError = (err: any) =>
    Alert.alert(t('common.error'), err?.response?.data?.error || t('profile.calendarFeed.error'))

  const create = useMutation({
    mutationFn: createCalendarFeed,
    onSuccess: (feed) => {
      setCreated(feed)
      queryClient.setQueryData<CalendarFeedStatus>(CALENDAR_FEED_QUERY_KEY, {
        enabled: true,
        createdAt: feed.createdAt,
        lastUsedAt: null,
      })
    },
    onError: showError,
  })

  const revoke = useMutation({
    mutationFn: revokeCalendarFeed,
    onSuccess: () => {
      setCreated(null)
      queryClient.setQueryData<CalendarFeedStatus>(CALENDAR_FEED_QUERY_KEY, {
        enabled: false,
        createdAt: null,
        lastUsedAt: null,
      })
    },
    onError: showError,
  })

  if (!supported) return null

  const busy = create.isPending || revoke.isPending

  const confirmRegenerate = () =>
    Alert.alert(t('profile.calendarFeed.regenerateTitle'), t('profile.calendarFeed.regenerateMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.calendarFeed.regenerate'), style: 'destructive', onPress: () => create.mutate() },
    ])

  const confirmRevoke = () =>
    Alert.alert(t('profile.calendarFeed.revokeTitle'), t('profile.calendarFeed.revokeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.calendarFeed.revoke'), style: 'destructive', onPress: () => revoke.mutate() },
    ])

  const addToCalendar = async (feed: CreatedCalendarFeed) => {
    try {
      await Linking.openURL(feed.webcalUrl)
    } catch {
      Alert.alert(t('profile.calendarFeed.openFailedTitle'), t('profile.calendarFeed.openFailedMessage'))
    }
  }

  // The share sheet offers "Copy" on both platforms, so no clipboard module.
  const shareUrl = (feed: CreatedCalendarFeed) => void Share.share({ message: feed.url }).catch(() => {})

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('profile.calendarFeed.title')}</Text>
      <Text style={styles.description}>{t('profile.calendarFeed.description')}</Text>

      {isLoading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loading} />
      ) : created ? (
        <View style={styles.block}>
          <Text style={styles.onceNotice}>{t('profile.calendarFeed.shownOnce')}</Text>
          <Text style={styles.url} selectable testID="calendar-feed-url">
            {created.url}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void addToCalendar(created)}
            accessibilityRole="button"
          >
            <Icon name="calendar" size={16} color={colors.white} />
            <Text style={styles.primaryButtonText}>{t('profile.calendarFeed.addToCalendar')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineButton} onPress={() => shareUrl(created)} accessibilityRole="button">
            <Icon name="copy" size={16} color={colors.primary} />
            <Text style={styles.outlineButtonText}>{t('profile.calendarFeed.copy')}</Text>
          </TouchableOpacity>
          <Text style={styles.help}>{t('profile.calendarFeed.instructions')}</Text>
        </View>
      ) : status?.enabled ? (
        <View style={styles.block}>
          {status.createdAt && (
            <Text style={styles.meta}>
              {t('profile.calendarFeed.createdAt', { date: formatDateTime(status.createdAt) })}
            </Text>
          )}
          <Text style={styles.meta}>
            {status.lastUsedAt
              ? t('profile.calendarFeed.lastUsedAt', { date: formatDateTime(status.lastUsedAt) })
              : t('profile.calendarFeed.neverUsed')}
          </Text>
          <Text style={styles.help}>{t('profile.calendarFeed.lostLink')}</Text>
          <TouchableOpacity
            style={[styles.outlineButton, busy && styles.disabled]}
            onPress={confirmRegenerate}
            disabled={busy}
            accessibilityRole="button"
          >
            {create.isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="refresh-cw" size={16} color={colors.primary} />
            )}
            <Text style={styles.outlineButtonText}>{t('profile.calendarFeed.regenerate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dangerButton, busy && styles.disabled]}
            onPress={confirmRevoke}
            disabled={busy}
            accessibilityRole="button"
          >
            {revoke.isPending && <ActivityIndicator size="small" color={colors.danger} />}
            <Text style={styles.dangerButtonText}>{t('profile.calendarFeed.revoke')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.block}>
          <TouchableOpacity
            style={[styles.outlineButton, busy && styles.disabled]}
            onPress={() => create.mutate()}
            disabled={busy}
            accessibilityRole="button"
          >
            {create.isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="calendar" size={16} color={colors.primary} />
            )}
            <Text style={styles.outlineButtonText}>{t('profile.calendarFeed.create')}</Text>
          </TouchableOpacity>
          <Text style={styles.help}>{t('profile.calendarFeed.instructions')}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: profileSectionStyles.section,
  sectionTitle: profileSectionStyles.sectionTitle,
  description: profileSectionStyles.sectionDescription,
  loading: {
    alignSelf: 'flex-start',
  },
  block: {
    gap: 10,
  },
  onceNotice: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTitle,
  },
  url: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textTitle,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  meta: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  help: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 100,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.white,
  },
  outlineButton: profileSectionStyles.outlineButton,
  outlineButtonText: profileSectionStyles.outlineButtonText,
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  dangerButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.danger,
  },
  disabled: {
    opacity: 0.6,
  },
})
