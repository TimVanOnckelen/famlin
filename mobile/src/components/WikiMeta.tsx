import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { WikiPageSummary } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { formatRelativeDate } from '@/i18n/utils'

// A wiki page's category/circle/locked badges and "updated by … when" line,
// shared by the overview's rows and the page view (web's WikiMeta).
export function WikiMeta({ page }: { page: WikiPageSummary }) {
  const { t } = useTranslation()
  const when = formatRelativeDate(page.updatedAt)
  return (
    <View style={styles.meta}>
      {!!page.category && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{page.category}</Text>
        </View>
      )}
      {!!page.circle && (
        <View style={[styles.badge, styles.circleBadge]} accessibilityLabel={t('wiki.circleHint')}>
          <Icon name="users" size={12} color={colors.circleDark} />
          <Text style={[styles.badgeText, styles.circleBadgeText]}>{page.circle.name}</Text>
        </View>
      )}
      {page.locked && (
        <View style={styles.badge} accessibilityLabel={t('wiki.lockedHint')}>
          <Icon name="lock" size={12} color={colors.primary} />
          <Text style={styles.badgeText}>{t('wiki.locked')}</Text>
        </View>
      )}
      <Text style={styles.updated}>
        {page.updatedBy ? t('wiki.updatedBy', { name: page.updatedBy.name, when }) : t('wiki.updated', { when })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    backgroundColor: colors.primaryTint,
  },
  badgeText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.primary,
  },
  circleBadge: {
    backgroundColor: colors.circleTint,
  },
  circleBadgeText: {
    color: colors.circleDark,
  },
  updated: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
  },
})
