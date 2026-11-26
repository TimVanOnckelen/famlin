import React from 'react'
import { StyleSheet } from 'react-native'
import { render } from '@testing-library/react-native'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/MediaThumbnail', () => ({ MediaThumbnail: () => null }))
jest.mock('@/components/UploadProgressOverlay', () => ({ UploadProgressOverlay: () => null }))
jest.mock('@/hooks/useChatMessageComposer', () => ({
  useChatMessageComposer: () => ({
    text: '',
    setText: jest.fn(),
    attachment: null,
    removeAttachment: jest.fn(),
    pickAttachment: jest.fn(),
    submit: jest.fn(),
    canSend: false,
    uploading: false,
    uploadProgress: 0,
  }),
}))

import { ChatComposer } from '../ChatComposer'

it('keeps multiline input metrics stable on iOS', async () => {
  const { getByLabelText } = await render(<ChatComposer send={jest.fn()} />)

  const style = StyleSheet.flatten(getByLabelText('chat.placeholder').props.style)
  expect(style.lineHeight).toBe(20)
})
