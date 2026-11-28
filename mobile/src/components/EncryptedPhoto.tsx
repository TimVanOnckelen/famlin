import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'
import type { E2eAttachmentV1 } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { loadEncryptedPhoto, thumbnailDataUri } from '@/e2e/attachments'

// An end-to-end encrypted photo: shows the tiny inline preview while the blob
// downloads and decrypts into the cache, then the real picture.
export function EncryptedPhoto({
  messageId,
  attachment,
  style,
  onPress,
}: {
  messageId: string
  attachment: E2eAttachmentV1
  style?: StyleProp<ViewStyle>
  onPress?: (fileUri: string) => void
}) {
  const { t } = useTranslation()
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setFailed(false)
    loadEncryptedPhoto(messageId, attachment)
      .then((fileUri) => active && setUri(fileUri))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [messageId, attachment, attempt])

  const preview = thumbnailDataUri(attachment)
  return (
    <TouchableOpacity
      disabled={!uri || !onPress}
      onPress={() => uri && onPress?.(uri)}
      accessibilityLabel={t('postDetail.viewAttachment')}
      style={[styles.frame, style]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <>
          {!!preview && (
            <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={8} />
          )}
          <View style={styles.overlay}>
            {failed ? (
              <TouchableOpacity onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button">
                <Text style={styles.retry}>{t('e2e.photoFailed')}</Text>
              </TouchableOpacity>
            ) : (
              <ActivityIndicator color={colors.white} />
            )}
          </View>
        </>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  frame: { width: 220, height: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.border },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  retry: { color: colors.white, fontFamily: 'Nunito_700Bold', fontSize: 13, textAlign: 'center', padding: 12 },
})
