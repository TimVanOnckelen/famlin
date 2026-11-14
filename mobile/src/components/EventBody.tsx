import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import { Post } from '@/types'
import { RSVP_RESPONSES, RsvpResponse, rsvpEvent } from '@famlin/api-client'
import { patchPostInCaches } from '@/utils/postCache'
import { formatEventDeadline, formatEventWhen } from '@/utils/event'

const MAX_GUEST_AVATARS = 5

// Shared event rendering used by both PostCard (feed) and PostDetailScreen,
// via the postTypes registry. The title is `post.content`, already rendered
// by the caller; this adds the when/where, the RSVP buttons and the guest
// list. `post.event` is the server's read-time view (services/postTypes/event.ts),
// merged across the cross-post copies the viewer can see.
export function EventBody({ post }: { post: Post }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const event = post.event

  // Like votePoll, rsvpEvent returns the full shaped + enriched post, so the
  // server's answer replaces the cached post as is.
  const rsvpMutation = useMutation({
    mutationFn: (response: RsvpResponse) => rsvpEvent(post.id, response),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, post.id, () => updatedPost)
    },
  })

  if (!event) return null

  const disabled = event.closed || rsvpMutation.isPending

  return (
    <View style={styles.container}>
      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Icon name="calendar" size={15} color={colors.primary} />
          <Text style={styles.detailText}>{formatEventWhen(event.startsAt, event.endsAt, i18n.language)}</Text>
        </View>
        {!!event.location && (
          <View style={styles.detailRow}>
            <Icon name="map-pin" size={15} color={colors.primary} />
            <Text style={styles.detailText}>{event.location}</Text>
          </View>
        )}
        {!!event.rsvpDeadline && !event.closed && (
          <View style={styles.detailRow}>
            <Icon name="clock" size={15} color={colors.textMuted} />
            <Text style={[styles.detailText, styles.detailTextMuted]}>
              {t('event.rsvpBy', { date: formatEventDeadline(event.rsvpDeadline, i18n.language) })}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.rsvpRow} accessibilityLabel={t('event.rsvpLabel')}>
        {RSVP_RESPONSES.map((response) => {
          const isMine = event.myRsvp === response
          return (
            <TouchableOpacity
              key={response}
              testID={`event-rsvp-${response}`}
              style={[styles.rsvpOption, isMine && styles.rsvpOptionMine, event.closed && styles.rsvpOptionClosed]}
              // The same answer again clears it, a different one switches.
              onPress={() => rsvpMutation.mutate(response)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: isMine, disabled: event.closed }}
              accessibilityLabel={`${t(`event.${response}`)}, ${event.counts[response]}`}
            >
              {isMine && <Icon name="check" size={14} color={colors.white} />}
              <Text style={[styles.rsvpText, isMine && styles.rsvpTextMine]} numberOfLines={1}>
                {t(`event.${response}`)}
              </Text>
              <Text style={[styles.rsvpCount, isMine && styles.rsvpTextMine]}>{event.counts[response]}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {RSVP_RESPONSES.map((response) => {
        const people = event.responses[response]
        if (people.length === 0) return null
        return (
          <View key={response} style={styles.guestRow} testID={`event-guests-${response}`}>
            <Text style={styles.guestLabel}>{t(`event.${response}`)}</Text>
            <View style={styles.guestStack}>
              {people.slice(0, MAX_GUEST_AVATARS).map((person, index) => (
                <View key={person.id} style={[styles.guestFace, index > 0 && styles.guestFaceOverlap]}>
                  <Avatar name={person.name} avatarUrl={person.avatarUrl} size={20} />
                </View>
              ))}
            </View>
            <Text style={styles.guestNames} numberOfLines={2}>
              {people.map((person) => person.name).join(', ')}
            </Text>
          </View>
        )
      })}

      {rsvpMutation.isError && (
        <Text style={styles.error} accessibilityRole="alert">
          {t('event.rsvpFailed')}
        </Text>
      )}
      {event.closed && <Text style={styles.closed}>{t('event.closed')}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 4,
    gap: 10,
  },
  details: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailText: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
  },
  detailTextMuted: {
    fontFamily: 'Nunito_600SemiBold',
    color: colors.textMuted,
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rsvpOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  rsvpOptionMine: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  rsvpOptionClosed: {
    opacity: 0.6,
  },
  rsvpText: {
    flexShrink: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
  },
  rsvpTextMine: {
    color: colors.white,
  },
  rsvpCount: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guestLabel: {
    width: 72,
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textMuted,
  },
  guestStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  guestFace: {
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 11,
  },
  guestFaceOverlap: {
    marginLeft: -6,
  },
  guestNames: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textBody,
  },
  error: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.danger,
  },
  closed: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
  },
})
