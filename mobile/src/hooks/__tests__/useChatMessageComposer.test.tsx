import { act, renderHook } from '@testing-library/react-native'
import { Alert } from 'react-native'

const mockPick = jest.fn()
const mockSend = jest.fn()

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { All: 'All' } }))
jest.mock('@/hooks/usePickAndUploadMedia', () => ({
  usePickAndUploadMedia: (options: unknown) => {
    ;(globalThis as any).__chatUploadOptions = options
    return { pick: mockPick, uploading: false, progress: null }
  },
}))

import { useChatMessageComposer } from '../useChatMessageComposer'

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('sends text-only, media-only, and mixed drafts only after upload URLs exist', async () => {
  mockSend.mockResolvedValue(undefined)
  const hook = await renderHook(() => useChatMessageComposer({ send: mockSend }))

  await act(async () => {
    hook.result.current.setText('hello')
    await hook.result.current.submit()
  })
  expect(mockSend).toHaveBeenNthCalledWith(1, { content: 'hello' })

  mockPick.mockResolvedValueOnce({
    assets: [{ uri: 'file:///photo.jpg', isVideo: false }],
    urls: ['/uploads/photo.jpg'],
  })
  await act(async () => {
    await hook.result.current.pickAttachment()
    await hook.result.current.submit()
  })
  expect(mockSend).toHaveBeenNthCalledWith(2, { attachmentUrl: '/uploads/photo.jpg' })

  mockPick.mockResolvedValueOnce({
    assets: [{ uri: 'file:///video.mp4', isVideo: true }],
    urls: ['/uploads/video.mp4'],
  })
  await act(async () => {
    hook.result.current.setText('watch this')
    await hook.result.current.pickAttachment()
    await hook.result.current.submit()
  })
  expect(mockSend).toHaveBeenNthCalledWith(3, {
    content: 'watch this',
    attachmentUrl: '/uploads/video.mp4',
  })
})

it('keeps the draft on send failure and clears it only after a successful retry', async () => {
  mockSend.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
  const hook = await renderHook(() => useChatMessageComposer({ send: mockSend }))

  await act(async () => {
    hook.result.current.setText('do not lose me')
    await hook.result.current.submit()
  })
  expect(hook.result.current.text).toBe('do not lose me')
  expect(Alert.alert).toHaveBeenCalled()

  await act(async () => {
    await hook.result.current.submit()
  })
  expect(hook.result.current.text).toBe('')
})

it('removes an optimistic attachment and clears it after upload failure so the user can retry', async () => {
  const hook = await renderHook(() => useChatMessageComposer({ send: mockSend }))
  const uploadOptions = (globalThis as any).__chatUploadOptions

  await act(async () => {
    uploadOptions.onPicked([{ uri: 'file:///retry.jpg', isVideo: false }])
  })
  expect(hook.result.current.attachment?.uri).toBe('file:///retry.jpg')
  await act(async () => hook.result.current.removeAttachment())
  expect(hook.result.current.attachment).toBeNull()

  await act(async () => {
    uploadOptions.onPicked([{ uri: 'file:///failed.mp4', isVideo: true }])
    uploadOptions.onError(new Error('upload failed'))
  })
  expect(hook.result.current.attachment).toBeNull()
  expect(hook.result.current.canSend).toBe(false)
})
