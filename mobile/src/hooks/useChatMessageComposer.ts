import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useTranslation } from 'react-i18next'
import type { SendChatMessageBody } from '@famlin/api-client'
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia'

interface Attachment {
  uri: string
  isVideo: boolean
  uploadedUrl?: string
}

export function useChatMessageComposer({ send }: { send: (body: SendChatMessageBody) => Promise<unknown> }) {
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
    const result = await upload.pick()
    if (!result) return
    const asset = result.assets[0]
    const uploadedUrl = result.urls[0]
    if (asset && uploadedUrl) setAttachment({ ...asset, uploadedUrl })
  }

  async function submit() {
    const content = textRef.current.trim()
    const uploadedUrl = attachmentRef.current?.uploadedUrl
    if ((!content && !uploadedUrl) || upload.uploading || sending) return false
    setSending(true)
    try {
      await send({
        ...(content ? { content } : {}),
        ...(uploadedUrl ? { attachmentUrl: uploadedUrl } : {}),
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

  const canSend = (!!textValue.trim() || !!attachment?.uploadedUrl) && !upload.uploading && !sending

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
