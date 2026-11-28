import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useTranslation } from 'react-i18next'
import type { SendChatMessageBody } from '@famlin/api-client'
import type { LocalPhoto } from '@/e2e/attachments'
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia'

interface Attachment {
  uri: string
  isVideo: boolean
  uploadedUrl?: string
  width?: number | null
  height?: number | null
}

/** What a composer hands to its `send`: in an encrypted conversation the photo stays local (`localPhoto`) and is encrypted before upload. */
export type ComposerSendBody = SendChatMessageBody & { localPhoto?: LocalPhoto }

export function useChatMessageComposer({
  send,
  encrypted = false,
  disabled = false,
}: {
  send: (body: ComposerSendBody) => Promise<unknown>
  /** End-to-end encrypted conversation: photos only, uploaded encrypted at send time. */
  encrypted?: boolean
  /** Nothing may be sent yet (e.g. still unknown whether the conversation can be encrypted). */
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [textValue, setTextValue] = useState('')
  const [attachment, setAttachmentValue] = useState<Attachment | null>(null)
  const [sending, setSending] = useState(false)
  const textRef = useRef('')
  const attachmentRef = useRef<Attachment | null>(null)

  function setText(value: string) {
    textRef.current = value
    setTextValue(value)
  }

  function setAttachment(value: Attachment | null) {
    attachmentRef.current = value
    setAttachmentValue(value)
  }

  const upload = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
    },
    onPicked: ([asset]) => setAttachment(asset ? { ...asset } : null),
    onError: () => setAttachment(null),
  })

  async function pickAttachment() {
    if (encrypted) {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      })
      const asset = picked.canceled ? null : picked.assets[0]
      if (asset) setAttachment({ uri: asset.uri, isVideo: false, width: asset.width, height: asset.height })
      return
    }
    const result = await upload.pick()
    if (!result) return
    const asset = result.assets[0]
    const uploadedUrl = result.urls[0]
    if (asset && uploadedUrl) setAttachment({ ...asset, uploadedUrl })
  }

  async function submit() {
    const content = textRef.current.trim()
    const current = attachmentRef.current
    const uploadedUrl = current?.uploadedUrl
    const localPhoto = encrypted && current ? current : undefined
    if ((!content && !uploadedUrl && !localPhoto) || upload.uploading || sending || disabled) return false
    setSending(true)
    try {
      await send({
        ...(content ? { content } : {}),
        ...(uploadedUrl && !encrypted ? { attachmentUrl: uploadedUrl } : {}),
        ...(localPhoto
          ? { localPhoto: { uri: localPhoto.uri, width: localPhoto.width, height: localPhoto.height } }
          : {}),
      })
      setText('')
      setAttachment(null)
      return true
    } catch (error: any) {
      Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('chat.sendFailed'))
      return false
    } finally {
      setSending(false)
    }
  }

  const hasAttachment = encrypted ? !!attachment : !!attachment?.uploadedUrl
  const canSend = (!!textValue.trim() || hasAttachment) && !upload.uploading && !sending && !disabled

  return {
    text: textValue,
    setText,
    attachment,
    removeAttachment: () => setAttachment(null),
    pickAttachment,
    submit,
    canSend,
    sending,
    uploading: upload.uploading,
    uploadProgress: upload.progress,
  }
}
