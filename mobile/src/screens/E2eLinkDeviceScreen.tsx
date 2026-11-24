import React, { useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { parseTransferQr } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { QrScannerModal } from '@/components/QrScannerModal'
import { ScreenHeader } from '@/components/ScreenHeader'
import { e2eStyles as s } from '@/components/e2eStyles'
import { useE2e } from '@/e2e/useE2e'
import { approveTransfer } from '@/e2e/actions'

function parseQr(data: string): string | null {
  try {
    parseTransferQr(data)
    return data
  } catch {
    return null
  }
}

// An already set-up phone hands the keys to a new one: scan the QR the new
// device shows (E2eRestoreScreen) and the keys travel sealed through the server.
export function E2eLinkDeviceScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const e2e = useE2e()
  const [scanning, setScanning] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function onScanned(qr: string) {
    setScanning(false)
    if (e2e.latestServerVersion === undefined) return
    setState('sending')
    try {
      await approveTransfer({ qr, latestVersion: e2e.latestServerVersion })
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <ScreenHeader title={t('e2e.link.title')} onBack={() => navigation.goBack()} centered />
      <ScrollView contentContainerStyle={s.content}>
        {e2e.status !== 'ready' ? (
          <Text style={s.body}>{t('e2e.link.notReady')}</Text>
        ) : state === 'done' ? (
          <>
            <Text style={s.title}>{t('e2e.link.doneTitle')}</Text>
            <Text style={s.body}>{t('e2e.link.doneBody')}</Text>
            <TouchableOpacity style={s.primaryButton} onPress={() => navigation.goBack()}>
              <Text style={s.primaryButtonText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.title}>{t('e2e.link.heading')}</Text>
            <Text style={s.body}>{t('e2e.link.body')}</Text>
            {state === 'error' && <Text style={s.error}>{t('e2e.link.failed')}</Text>}
            <TouchableOpacity
              style={[s.primaryButton, state === 'sending' && s.disabled]}
              disabled={state === 'sending'}
              onPress={() => setScanning(true)}
              accessibilityRole="button"
            >
              {state === 'sending' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={s.primaryButtonText}>{t('e2e.link.scan')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      <QrScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={onScanned}
        parse={parseQr}
        title={t('e2e.link.scanTitle')}
        hint={t('e2e.link.scanHint')}
      />
    </SafeAreaView>
  )
}
