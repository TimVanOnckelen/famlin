import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '@/constants/colors'
import { Icon, type IconName } from '@/components/Icon'

// A one-line status strip above the composer or at the top of a screen:
// icon, message, optional actions.
export function E2eNotice({
  icon,
  message,
  tone = 'info',
  actions = [],
}: {
  icon: IconName
  message: string
  tone?: 'info' | 'warning'
  actions?: { label: string; onPress: () => void }[]
}) {
  return (
    <View style={[styles.box, tone === 'warning' && styles.boxWarning]}>
      <View style={styles.row}>
        <Icon name={icon} size={16} color={tone === 'warning' ? colors.textTitle : colors.primary} />
        <Text style={styles.message}>{message}</Text>
      </View>
      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((action) => (
            <TouchableOpacity key={action.label} onPress={action.onPress} accessibilityRole="button">
              <Text style={styles.action}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 6,
    backgroundColor: colors.primaryTint,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  boxWarning: { backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  message: { flex: 1, color: colors.textBody, fontFamily: 'Nunito_600SemiBold', fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 18, paddingLeft: 24 },
  action: { color: colors.primary, fontFamily: 'Nunito_700Bold', fontSize: 14, paddingVertical: 2 },
})
