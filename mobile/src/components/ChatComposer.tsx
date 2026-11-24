import React from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { SendChatMessageBody } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { MediaThumbnail } from '@/components/MediaThumbnail'
import { UploadProgressOverlay } from '@/components/UploadProgressOverlay'
import { useChatMessageComposer } from '@/hooks/useChatMessageComposer'

export function ChatComposer({ send }: { send: (body: SendChatMessageBody) => Promise<unknown> }) {
  const { t } = useTranslation()
  const composer = useChatMessageComposer({ send })

  return (
    <View>
      {!!composer.attachment && (
        <View style={styles.previewRow}>
          <View style={styles.preview}>
            <MediaThumbnail url={composer.attachment.uri} style={styles.previewImage} />
            {composer.uploading && (
              <UploadProgressOverlay progress={composer.uploadProgress} style={styles.uploadOverlay} />
            )}
            <TouchableOpacity
              style={styles.remove}
              onPress={composer.removeAttachment}
              accessibilityLabel={t('postDetail.removeAttachment')}
            >
              <Icon name="x" size={12} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      )}
      <View style={styles.inputContainer}>
        <TouchableOpacity
          style={styles.attach}
          onPress={composer.pickAttachment}
          disabled={composer.uploading}
          accessibilityLabel={t('chat.addAttachment')}
        >
          <Icon name="image" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.textMuted}
          value={composer.text}
          onChangeText={composer.setText}
          multiline
          accessibilityLabel={t('chat.placeholder')}
        />
        <TouchableOpacity
          style={[styles.send, !composer.canSend && styles.sendDisabled]}
          onPress={composer.submit}
          disabled={!composer.canSend}
          accessibilityLabel={t('chat.send')}
        >
          <Icon name="send" size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  previewRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  preview: { width: 74, height: 74, borderRadius: 12, overflow: 'hidden' },
  previewImage: { width: 74, height: 74 },
  uploadOverlay: { ...StyleSheet.absoluteFill },
  remove: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attach: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 19,
    backgroundColor: colors.bg,
    color: colors.textBody,
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: { opacity: 0.45 },
})
