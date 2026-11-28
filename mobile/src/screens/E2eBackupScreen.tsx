import React, { useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Share, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { e2eStyles as s } from '@/components/e2eStyles'
import { useAuthStore } from '@/stores/authStore'
import { useE2e } from '@/e2e/useE2e'
import { confirmRecoverySaved, createBackup } from '@/e2e/actions'

function serverHost(url: string | null): string {
  try {
    return new URL(url ?? '').host
  } catch {
    return url ?? ''
  }
}

// Optional backup of the encrypted messages: a recovery code needed to read
// old messages on a new phone when the old one is gone.
export function E2eBackupScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const queryClient = useQueryClient()
  const e2e = useE2e()
  const serverUrl = useAuthStore((state) => state.serverUrl)
  const [code, setCode] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function start() {
    if (e2e.latestServerVersion === undefined || busy) return
    setBusy(true)
    try {
      const created = await createBackup('recoveryCode', { latestVersion: e2e.latestServerVersion, queryClient })
      setCode(created.code)
    } catch (error: any) {
      Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('common.tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    await confirmRecoverySaved()
    navigation.goBack()
  }

  return (
    <SafeAreaView style={s.container}>
      <ScreenHeader title={t('e2e.backup.title')} onBack={() => navigation.goBack()} centered />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {code ? (
          <>
            <Text style={s.title}>{t('e2e.backup.codeTitle')}</Text>
            <Text style={s.body}>{t('e2e.backup.codeBody')}</Text>
            {/* A username + new-password pair lets the phone offer to save the code in its password manager. */}
            <TextInput
              style={[s.input, { fontSize: 14 }]}
              value={`Famlin – ${serverHost(serverUrl)}`}
              editable={false}
              textContentType="username"
              autoComplete="username"
              accessibilityLabel={t('e2e.backup.accountLabel')}
            />
            <TextInput
              style={s.input}
              value={code}
              editable={false}
              selectTextOnFocus
              textContentType="newPassword"
              autoComplete="password-new"
              accessibilityLabel={t('e2e.backup.codeTitle')}
            />
            <TouchableOpacity
              style={s.secondaryButton}
              onPress={() => Share.share({ message: code })}
              accessibilityRole="button"
            >
              <Text style={s.secondaryButtonText}>{t('e2e.backup.shareCode')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.checkRow}
              onPress={() => setSaved((value) => !value)}
              accessibilityRole="checkbox"
            >
              <View style={[s.checkbox, saved && s.checkboxOn]}>
                {saved && <Icon name="check" size={16} color={colors.white} />}
              </View>
              <Text style={s.checkLabel}>{t('e2e.backup.saved')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.primaryButton, !saved && s.disabled]}
              disabled={!saved}
              onPress={finish}
              accessibilityRole="button"
            >
              <Text style={s.primaryButtonText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.title}>{t('e2e.backup.title')}</Text>
            <Text style={s.body}>{t('e2e.backup.body')}</Text>
            <TouchableOpacity
              style={[s.primaryButton, (busy || e2e.latestServerVersion === undefined) && s.disabled]}
              disabled={busy || e2e.latestServerVersion === undefined}
              onPress={start}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={s.primaryButtonText}>{t('e2e.backup.start')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
