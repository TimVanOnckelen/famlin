import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { E2eError } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { QrCodeView } from '@/components/QrCodeView'
import { ScreenHeader } from '@/components/ScreenHeader'
import { e2eStyles as s } from '@/components/e2eStyles'
import { useE2e } from '@/e2e/useE2e'
import { createIdentity, restoreWithCode, startTransfer, type TransferSession } from '@/e2e/actions'

type Mode = 'menu' | 'scan' | 'code'

// This device has no keys for the account's latest identity: get them from
// another phone (QR), with the recovery code, or give up and start over.
export function E2eRestoreScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const queryClient = useQueryClient()
  const e2e = useE2e()
  const [mode, setMode] = useState<Mode>('menu')
  const [qr, setQr] = useState<string | null>(null)
  const [transferError, setTransferError] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<TransferSession | null>(null)
  const latest = e2e.serverIdentities?.[0]
  const hasBackup = !!latest?.recoveryBackup

  useEffect(() => {
    if (mode !== 'scan' || !e2e.userId || !latest) return
    setTransferError(false)
    const started = startTransfer({ userId: e2e.userId, latest, queryClient })
    session.current = started
    setQr(started.qr)
    started.done.catch((err: Error) => {
      if (err.message !== 'cancelled') setTransferError(true)
    })
    return () => started.cancel()
    // A new session per visit to the scan mode only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, e2e.userId, latest?.version])

  async function restore() {
    if (!e2e.userId || !latest || busy) return
    setBusy(true)
    setError(null)
    try {
      await restoreWithCode({ userId: e2e.userId, code, latest, queryClient })
    } catch (err) {
      const codeName = err instanceof E2eError ? err.code : null
      setError(
        codeName === 'invalid_recovery_code'
          ? t('e2e.restore.invalid')
          : codeName === 'wrong_recovery_code'
            ? t('e2e.restore.wrong')
            : t('e2e.restore.failed')
      )
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    Alert.alert(t('e2e.restore.startOverTitle'), t('e2e.restore.startOverMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('e2e.restore.startOverConfirm'),
        style: 'destructive',
        onPress: async () => {
          if (!e2e.userId || !e2e.serverIdentities) return
          try {
            // New keys, silently; old messages stay readable only where the old keys are.
            await createIdentity({ userId: e2e.userId, serverIdentities: e2e.serverIdentities, queryClient })
          } catch (err: any) {
            Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('common.tryAgain'))
          }
        },
      },
    ])
  }

  if (e2e.status === 'ready') {
    return (
      <SafeAreaView style={s.container}>
        <ScreenHeader title={t('e2e.title')} onBack={() => navigation.goBack()} centered />
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.title}>{t('e2e.restore.doneTitle')}</Text>
          <Text style={s.body}>{t('e2e.restore.doneBody')}</Text>
          <TouchableOpacity style={s.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={s.primaryButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.container}>
      <ScreenHeader
        title={t('e2e.title')}
        onBack={() => (mode === 'menu' ? navigation.goBack() : setMode('menu'))}
        centered
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {mode === 'menu' && (
          <>
            <Text style={s.title}>{t('e2e.restore.title')}</Text>
            <Text style={s.body}>{t('e2e.restore.body')}</Text>
            <TouchableOpacity style={s.primaryButton} onPress={() => setMode('scan')} accessibilityRole="button">
              <Text style={s.primaryButtonText}>{t('e2e.restore.scan')}</Text>
            </TouchableOpacity>
            {hasBackup ? (
              <TouchableOpacity style={s.secondaryButton} onPress={() => setMode('code')} accessibilityRole="button">
                <Text style={s.secondaryButtonText}>{t('e2e.restore.enterCode')}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.body}>{t('e2e.restore.noBackup')}</Text>
            )}
            <TouchableOpacity style={s.linkButton} onPress={startOver}>
              <Text style={s.linkButtonText}>{t('e2e.restore.startOver')}</Text>
            </TouchableOpacity>
          </>
        )}
        {mode === 'scan' && (
          <View style={s.center}>
            <Text style={s.title}>{t('e2e.restore.scanTitle')}</Text>
            <Text style={s.body}>{t('e2e.restore.scanBody')}</Text>
            {qr && <QrCodeView value={qr} size={240} />}
            {transferError ? (
              <>
                <Text style={s.error}>{t('e2e.restore.scanTimeout')}</Text>
                <TouchableOpacity
                  style={s.secondaryButton}
                  onPress={() => {
                    setMode('menu')
                    setTimeout(() => setMode('scan'), 0)
                  }}
                >
                  <Text style={s.secondaryButtonText}>{t('e2e.restore.tryAgain')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={s.body}>{t('e2e.restore.waiting')}</Text>
              </>
            )}
          </View>
        )}
        {mode === 'code' && (
          <>
            <Text style={s.title}>{t('e2e.restore.codeTitle')}</Text>
            <Text style={s.body}>{t('e2e.restore.codeBody')}</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('e2e.restore.codeTitle')}
            />
            {!!error && <Text style={s.error}>{error}</Text>}
            <TouchableOpacity
              style={[s.primaryButton, (busy || !code.trim() || !latest) && s.disabled]}
              disabled={busy || !code.trim() || !latest}
              onPress={restore}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={s.primaryButtonText}>{t('e2e.restore.restore')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
