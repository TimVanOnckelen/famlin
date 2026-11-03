import React, { useEffect, useRef, useState } from 'react'
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/components/Icon'
import { colors } from '@/constants/colors'
import { parseConnectQr } from '@/utils/connectQr'

interface QrScannerModalProps {
  visible: boolean
  onClose: () => void
  /** Called once with the server origin read from a valid Famlin QR code. */
  onScanned: (server: string) => void
}

export function QrScannerModal({ visible, onClose, onScanned }: QrScannerModalProps) {
  const { t } = useTranslation()
  const [permission, requestPermission] = useCameraPermissions()
  const [invalid, setInvalid] = useState(false)
  const handledRef = useRef(false)
  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) return
    handledRef.current = false
    setInvalid(false)
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(
    () => () => {
      if (invalidTimer.current) clearTimeout(invalidTimer.current)
    },
    []
  )

  function handleScan({ data }: { data: string }) {
    if (handledRef.current) return
    const server = parseConnectQr(data)
    if (!server) {
      // Keep scanning, but tell the user this wasn't a Famlin code.
      setInvalid(true)
      if (invalidTimer.current) clearTimeout(invalidTimer.current)
      invalidTimer.current = setTimeout(() => setInvalid(false), 2500)
      return
    }
    handledRef.current = true
    onScanned(server)
  }

  const denied = permission && !permission.granted && !permission.canAskAgain

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('connect.scanTitle')}</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Icon name="x" size={26} color={colors.white} />
          </TouchableOpacity>
        </View>

        {permission?.granted ? (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScan}
            />
            <View style={styles.frame} pointerEvents="none" />
          </View>
        ) : (
          <View style={styles.message}>
            <Icon name="camera" size={40} color={colors.white} />
            <Text style={styles.messageText}>{denied ? t('connect.cameraDenied') : t('connect.cameraRequesting')}</Text>
            {denied && (
              <TouchableOpacity style={styles.button} onPress={() => Linking.openSettings()}>
                <Text style={styles.buttonText}>{t('connect.openSettings')}</Text>
              </TouchableOpacity>
            )}
            {!denied && permission && !permission.granted && (
              <TouchableOpacity style={styles.button} onPress={() => requestPermission()}>
                <Text style={styles.buttonText}>{t('connect.allowCamera')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={[styles.hint, invalid && styles.hintInvalid]}>
          {invalid ? t('connect.invalidCode') : t('connect.scanHint')}
        </Text>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { fontFamily: 'Nunito_800ExtraBold', fontSize: 20, color: colors.white },
  cameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.white,
  },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  messageText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 100,
    backgroundColor: colors.primary,
  },
  buttonText: { fontFamily: 'Nunito_700Bold', fontSize: 16, color: colors.white },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  hintInvalid: { color: '#ffb4a8' },
})
