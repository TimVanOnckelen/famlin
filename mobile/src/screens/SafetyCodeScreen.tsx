import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { chatConversationsQueryKey, fetchChatConversations } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { QrCodeView } from '@/components/QrCodeView'
import { QrScannerModal } from '@/components/QrScannerModal'
import { ScreenHeader } from '@/components/ScreenHeader'
import { e2eStyles as s } from '@/components/e2eStyles'
import { useAuthStore } from '@/stores/authStore'
import { useE2eKeysStore } from '@/e2e/keysStore'
import { useDmCrypto } from '@/e2e/useDmCrypto'
import { chatConversationTitle } from '@/utils/chatConversations'
import { parseSafetyQr, safetyQrPayload } from '@/e2e/safetyQr'

// Compare this code (or scan the QR) with the other person, in person or over
// a call: if it matches, nobody — not even the server — swapped your keys.
export function SafetyCodeScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const { conversationId } = useRoute<any>().params as { conversationId: string }
  const userId = useAuthStore((state) => state.user?.id)
  const { data } = useQuery({ queryKey: chatConversationsQueryKey(), queryFn: fetchChatConversations })
  const conversation = data?.items.find((item) => item.id === conversationId)
  const crypto = useDmCrypto(conversation, [])
  const { meta, setContactPin } = useE2eKeysStore()
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<'match' | 'mismatch' | null>(null)
  const name = conversation ? chatConversationTitle(conversation, userId) : ''
  const code = crypto.safetyCode
  const pin = crypto.peerId ? meta.contacts[crypto.peerId] : undefined

  function setVerified(verified: boolean) {
    if (!crypto.peerId || !code || !pin) return
    void setContactPin(crypto.peerId, { ...pin, verifiedSafetyCode: verified ? code : undefined })
  }

  function onScanned(digits: string) {
    setScanning(false)
    const match = !!code && digits === code.replace(/ /g, '')
    setScanResult(match ? 'match' : 'mismatch')
    if (match) setVerified(true)
  }

  return (
    <SafeAreaView style={s.container}>
      <ScreenHeader title={t('e2e.safetyCode.title')} onBack={() => navigation.goBack()} centered />
      <ScrollView contentContainerStyle={s.content}>
        {!code ? (
          <Text style={s.body}>{t('e2e.safetyCode.unavailable', { name })}</Text>
        ) : (
          <>
            <Text style={s.body}>{t('e2e.safetyCode.body', { name })}</Text>
            <View style={s.codeBox}>
              <View style={styles.grid}>
                {code.split(' ').map((group, index) => (
                  <Text key={index} style={styles.group}>
                    {group}
                  </Text>
                ))}
              </View>
            </View>
            <View style={s.center}>
              <QrCodeView value={safetyQrPayload(code)} size={200} />
            </View>
            {crypto.verified && <Text style={styles.verified}>{t('e2e.safetyCode.verified', { name })}</Text>}
            {scanResult === 'match' && <Text style={styles.verified}>{t('e2e.safetyCode.scanMatch')}</Text>}
            {scanResult === 'mismatch' && <Text style={s.error}>{t('e2e.safetyCode.scanMismatch')}</Text>}
            <TouchableOpacity style={s.primaryButton} onPress={() => setScanning(true)} accessibilityRole="button">
              <Text style={s.primaryButtonText}>{t('e2e.safetyCode.scan')}</Text>
            </TouchableOpacity>
            {crypto.verified ? (
              <TouchableOpacity style={s.secondaryButton} onPress={() => setVerified(false)}>
                <Text style={s.secondaryButtonText}>{t('e2e.safetyCode.unmark')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.secondaryButton} onPress={() => setVerified(true)}>
                <Text style={s.secondaryButtonText}>{t('e2e.safetyCode.mark')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
      <QrScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={onScanned}
        parse={parseSafetyQr}
        title={t('e2e.safetyCode.scanTitle')}
        hint={t('e2e.safetyCode.scanHint', { name })}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 10, columnGap: 18 },
  group: {
    width: '25%',
    textAlign: 'center',
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    letterSpacing: 1,
    color: colors.textTitle,
  },
  verified: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.primary, textAlign: 'center' },
})
