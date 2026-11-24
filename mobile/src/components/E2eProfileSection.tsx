import React from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { profileSectionStyles } from '@/components/profileSectionStyles'
import { useE2e } from '@/e2e/useE2e'
import { useKeySyncAvailability, useNeedsRecoveryCode } from '@/e2e/useKeySync'
import { Platform } from 'react-native'
import { createBackup, createIdentity } from '@/e2e/actions'

// "Encrypted messages" on the profile: whether this device can read and send
// end-to-end encrypted direct messages, and the recovery tools. Hidden on a
// server that doesn't do them.
export function E2eProfileSection() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const queryClient = useQueryClient()
  const e2e = useE2e()
  const sync = useKeySyncAvailability().data
  const hasBackup = !!e2e.serverIdentities?.[0]?.recoveryBackup
  const needsReminder = useNeedsRecoveryCode(hasBackup)
  if (e2e.status === 'unsupported') return null

  const ready = e2e.status === 'ready'

  function showRecoveryCode() {
    Alert.alert(t('e2e.profile.showTitle'), t('e2e.profile.showMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('e2e.profile.show'),
        onPress: () => {
          if (e2e.recoveryCode) {
            Alert.alert(t('e2e.profile.codeTitle'), e2e.recoveryCode)
          } else {
            Alert.alert(t('e2e.profile.noCodeTitle'), t('e2e.profile.noCodeMessage'))
          }
        },
      },
    ])
  }

  function newCode() {
    Alert.alert(t('e2e.profile.newCodeTitle'), t('e2e.profile.newCodeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('e2e.profile.newCode'),
        onPress: async () => {
          if (e2e.latestServerVersion === undefined) return
          try {
            const { code } = await createBackup('recoveryCode', { latestVersion: e2e.latestServerVersion, queryClient })
            Alert.alert(t('e2e.profile.codeTitle'), `${code}\n\n${t('e2e.profile.newCodeSaved')}`, [
              { text: t('common.done') },
            ])
          } catch (error: any) {
            Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('common.tryAgain'))
          }
        },
      },
    ])
  }

  function reset() {
    Alert.alert(t('e2e.profile.resetTitle'), t('e2e.profile.resetMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('e2e.profile.reset'),
        style: 'destructive',
        onPress: async () => {
          if (!e2e.userId || !e2e.serverIdentities) return
          try {
            await createIdentity({ userId: e2e.userId, serverIdentities: e2e.serverIdentities, queryClient })
            Alert.alert(t('e2e.profile.resetDone'))
          } catch (error: any) {
            Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('common.tryAgain'))
          }
        },
      },
    ])
  }

  const rows: {
    label: string
    onPress: () => void
    icon: React.ComponentProps<typeof Icon>['name']
    danger?: boolean
  }[] = []
  if (e2e.status === 'needsRestore') {
    rows.push({ label: t('e2e.banner.restore'), onPress: () => navigation.navigate('E2eRestore'), icon: 'key' })
    rows.push({ label: t('e2e.profile.reset'), onPress: reset, icon: 'refresh-cw', danger: true })
  } else if (ready) {
    if (hasBackup) {
      rows.push({ label: t('e2e.profile.showCode'), onPress: showRecoveryCode, icon: 'key' })
      rows.push({ label: t('e2e.profile.newCode'), onPress: newCode, icon: 'refresh-cw' })
    } else {
      rows.push({ label: t('e2e.profile.backupNow'), onPress: () => navigation.navigate('E2eBackup'), icon: 'shield' })
    }
    rows.push({
      label: t('e2e.profile.linkDevice'),
      onPress: () => navigation.navigate('E2eLinkDevice'),
      icon: 'smartphone',
    })
    rows.push({ label: t('e2e.profile.reset'), onPress: reset, icon: 'alert-triangle', danger: true })
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('e2e.title')}</Text>
      <Text style={styles.sectionDescription}>{t(`e2e.profile.status.${e2e.status}`)}</Text>
      {ready && sync?.available !== false && (
        <Text style={styles.sectionDescription}>
          {t(
            Platform.OS === 'ios'
              ? 'e2e.sync.statusIos'
              : sync?.endToEndEncrypted === false
                ? 'e2e.sync.statusAndroidNoLock'
                : 'e2e.sync.statusAndroid'
          )}
        </Text>
      )}
      {ready && needsReminder && (
        <View style={styles.reminder}>
          <Icon name="alert-circle" size={16} color={colors.textTitle} />
          <Text style={styles.reminderText}>{t('e2e.profile.reminder')}</Text>
        </View>
      )}
      {rows.map((row) => (
        <TouchableOpacity key={row.label} style={styles.row} onPress={row.onPress} accessibilityRole="button">
          <Icon name={row.icon} size={18} color={row.danger ? colors.danger : colors.primary} />
          <Text style={[styles.rowText, row.danger && { color: colors.danger }]}>{row.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  section: profileSectionStyles.section,
  sectionTitle: profileSectionStyles.sectionTitle,
  sectionDescription: profileSectionStyles.sectionDescription,
  reminder: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.bg,
    marginBottom: 10,
  },
  reminderText: { flex: 1, fontFamily: 'Nunito_700Bold', fontSize: 13, color: colors.textTitle },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowText: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.primary },
})
