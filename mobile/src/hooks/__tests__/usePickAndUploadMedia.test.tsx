import { act, renderHook, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { uploadMedia } from '@/api/uploads'
import { usePickAndUploadMedia } from '../usePickAndUploadMedia'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn() }))
jest.mock('@/api/uploads', () => ({ uploadMedia: jest.fn() }))

function deferred() {
  let resolve!: (urls: string[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string[]>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  jest
    .mocked(ImagePicker.requestMediaLibraryPermissionsAsync)
    .mockResolvedValue({ status: 'granted' } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >)
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///first.jpg', type: 'image', fileName: 'first.jpg', mimeType: 'image/jpeg' },
      { uri: 'file:///second.mp4', type: 'video', fileName: 'second.mp4', mimeType: 'video/mp4' },
    ],
  } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>)
})
afterEach(() => jest.restoreAllMocks())

it('sends files independently and reports progress and completion before the batch finishes', async () => {
  const first = deferred()
  const second = deferred()
  jest
    .mocked(uploadMedia)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  const onUploaded = jest.fn()
  const onSettled = jest.fn()
  const hook = await renderHook(() => usePickAndUploadMedia({ pickerOptions: {}, onUploaded, onSettled }))
  let pending!: ReturnType<typeof hook.result.current.pick>
  await act(async () => {
    pending = hook.result.current.pick()
  })
  await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(2))
  expect(jest.mocked(uploadMedia).mock.calls.map(([files]) => files.length)).toEqual([1, 1])
  await act(async () => {
    jest.mocked(uploadMedia).mock.calls[0][1]!(0.75)
  })
  expect(hook.result.current.fileProgress).toEqual([0.75, 0])
  await act(async () => {
    first.resolve(['/uploads/first.jpg'])
  })
  expect(onUploaded).toHaveBeenCalledWith('/uploads/first.jpg', 0)
  expect(onSettled).toHaveBeenCalledWith(0)
  expect(hook.result.current.uploading).toBe(true)
  await act(async () => {
    second.resolve(['/uploads/second.mp4'])
    await pending
  })
  expect(hook.result.current.uploading).toBe(false)
  expect(onUploaded).toHaveBeenCalledWith('/uploads/second.mp4', 1)
  await hook.unmount()
})

it('keeps successful files when another upload fails and waits for all requests to settle', async () => {
  const first = deferred()
  const second = deferred()
  jest
    .mocked(uploadMedia)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  const hook = await renderHook(() => usePickAndUploadMedia({ pickerOptions: {} }))
  let pending!: ReturnType<typeof hook.result.current.pick>
  await act(async () => {
    pending = hook.result.current.pick()
  })
  await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(2))
  await act(async () => {
    first.reject(new Error('Upload failed'))
  })
  expect(hook.result.current.uploading).toBe(true)
  let response: Awaited<typeof pending>
  await act(async () => {
    second.resolve(['/uploads/second.mp4'])
    response = await pending
  })
  expect(response!.urls).toEqual(['/uploads/second.mp4'])
  expect(response!.assets).toEqual([{ uri: 'file:///second.mp4', isVideo: true }])
  expect(Alert.alert).toHaveBeenCalledTimes(1)
  expect(hook.result.current.uploading).toBe(false)
  await hook.unmount()
})

it('uploads shared files through the same completion callbacks without opening the picker', async () => {
  jest.mocked(uploadMedia).mockResolvedValueOnce(['/uploads/shared.mp4'])
  const onUploaded = jest.fn()
  const onSettled = jest.fn()
  const hook = await renderHook(() => usePickAndUploadMedia({ pickerOptions: {}, onUploaded, onSettled }))
  let response: Awaited<ReturnType<typeof hook.result.current.upload>>
  await act(async () => {
    response = await hook.result.current.upload([
      { uri: 'file:///shared.mp4', isVideo: true, mimeType: 'video/mp4', fromOutsidePicker: true },
    ])
  })
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
  expect(response!.urls).toEqual(['/uploads/shared.mp4'])
  expect(onUploaded).toHaveBeenCalledTimes(1)
  expect(onUploaded).toHaveBeenCalledWith('/uploads/shared.mp4', 0)
  expect(onSettled).toHaveBeenCalledWith(0)
  expect(hook.result.current.uploading).toBe(false)
  await hook.unmount()
})
