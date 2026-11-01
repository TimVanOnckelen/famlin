import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { Avatar } from '@/components/Avatar'
import { Post } from '@/types'
import { formatDayMonth } from '@/i18n/utils'

// The feed card for a GIFT_LIST post (issue #307): title, occasion date,
// participants, draw status and — once drawn — who YOU are buying for. The
// whole card opens GiftListScreen. Mirrors web's GiftListFeedCard.
export function GiftListCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const giftList = post.giftList
  if (!giftList) return null

  const meta = [
    giftList.occasionDate && formatDayMonth(giftList.occasionDate),
    t('giftList.participantCount', { count: giftList.participants.length }),
    giftList.budget && t('giftList.budgetValue', { budget: giftList.budget }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={() => navigation.navigate('GiftList', { postId: post.id })}
    >
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Icon name="gift" size={11} color={colors.white} />
          <Text style={styles.badgeText}>{t('giftList.badge')}</Text>
        </View>
        {showGroup && post.group && (
          <Text style={styles.group} numberOfLines={1}>
            {post.group.name}
          </Text>
        )}
      </View>
      <Text style={styles.title}>{giftList.title}</Text>
      <Text style={styles.muted}>{meta}</Text>
      <View style={styles.faces}>
        {giftList.participants.slice(0, 8).map((p, i) => (
          <View key={p.id} style={i > 0 && styles.faceOverlap}>
            <Avatar name={p.name} avatarUrl={p.avatarUrl} size={26} />
          </View>
        ))}
      </View>
      {giftList.myRecipient ? (
        <View style={styles.recipient}>
          <Icon name="gift" size={15} color={colors.primaryDark} />
          <Text style={styles.recipientText}>{t('giftList.buyingFor', { name: giftList.myRecipient.name })}</Text>
        </View>
      ) : (
        giftList.drawEnabled && <Text style={styles.muted}>{t('giftList.drawPending')}</Text>
      )}
      <Text style={styles.cta}>{t('giftList.openCta')}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primaryTint,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  badgeText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 11, color: colors.white },
  group: { fontFamily: 'Nunito_700Bold', fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  title: { fontFamily: 'Nunito_900Black', fontSize: 19, color: colors.textTitle },
  muted: { fontFamily: 'Nunito_600SemiBold', fontSize: 13, color: colors.textMuted },
  faces: { flexDirection: 'row' },
  faceOverlap: { marginLeft: -8 },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
  },
  recipientText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 14, color: colors.primaryDark },
  cta: { fontFamily: 'Nunito_800ExtraBold', fontSize: 14, color: colors.primary, alignSelf: 'flex-end' },
})
