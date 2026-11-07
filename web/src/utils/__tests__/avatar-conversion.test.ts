import { fetchUploadProcessing, getUploadUrl, uploadFiles } from '@famlin/api-client'
import { convertAvatarForPreview, isHeicImage } from '../avatar-conversion'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  uploadFiles: vi.fn(),
  fetchUploadProcessing: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `${url}?token=media`),
}))

const url = '/uploads/12345678-1234-1234-1234-123456789abc.jpg'
const file = new File(['heic'], 'photo.heic', { type: 'image/heic' })
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(uploadFiles).mockResolvedValue([url])
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('detects HEIC/HEIF by filename or MIME type', () => {
  expect(isHeicImage(new File([], 'photo.HEIF'))).toBe(true)
  expect(isHeicImage(new File([], 'image', { type: 'image/heic' }))).toBe(true)
  expect(isHeicImage(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false)
})

it('waits for the full converted image and resolves its authorized URL', async () => {
  vi.mocked(getUploadUrl).mockImplementation((url) => `${url}?token=media`)
  vi.mocked(fetchUploadProcessing)
    .mockResolvedValueOnce({ status: 'queued', url: null, thumbnailUrl: null })
    .mockResolvedValueOnce({ status: 'ready', url, thumbnailUrl: null })
  const result = convertAvatarForPreview(file, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await result).toBe(`${url}?token=media`)
  expect(uploadFiles).toHaveBeenCalledWith([file])
  expect(fetchUploadProcessing).toHaveBeenCalledTimes(2)
})

it('stops polling on cancellation', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'processing', url: null, thumbnailUrl: null })
  const controller = new AbortController()
  const result = convertAvatarForPreview(file, controller.signal)
  const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await rejection
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchUploadProcessing).toHaveBeenCalledTimes(1)
})

it('reports server conversion failure', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'failed', url: null, thumbnailUrl: null })
  await expect(convertAvatarForPreview(file, new AbortController().signal)).rejects.toThrow('Image conversion failed')
})

it('bounds the processing wait instead of polling indefinitely', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'processing', url: null, thumbnailUrl: null })
  const result = convertAvatarForPreview(file, new AbortController().signal)
  const rejection = expect(result).rejects.toThrow('Image conversion timed out')
  await vi.advanceTimersByTimeAsync(120_000)
  await rejection
})
