import { render } from '@testing-library/react-native'
import { useVideoPlayer } from 'expo-video'
import { MediaThumbnail } from '../MediaThumbnail'
import { settledUploadProcessing, useUploadProcessing } from '@/hooks/useUploadProcessing'

jest.mock('@/hooks/useUploadProcessing', () => ({
  UploadProcessingContext: jest.requireActual('react').createContext(undefined),
  settledUploadProcessing: jest.fn(),
  useUploadProcessing: jest.fn(),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('../Icon', () => ({ Icon: 'Icon' }))
jest.mock('../LivePhotoMedia', () => ({ LivePhotoMedia: 'LivePhotoMedia' }))
jest.mock('expo-image', () => ({ Image: 'Image' }))
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: 'VideoView' }))

beforeEach(() => {
  jest.clearAllMocks()
  // Unknown state: the component has to ask the server through the hook.
  jest.mocked(settledUploadProcessing).mockReturnValue(null)
})

it('renders an upload whose state is already known without the status hook', async () => {
  jest.mocked(settledUploadProcessing).mockReturnValue({ status: 'ready', pending: false, failed: false })
  const screen = await render(<MediaThumbnail url="/uploads/photo.jpg" />)
  expect(useUploadProcessing).not.toHaveBeenCalled()
  expect(screen.queryByText('media.processing')).toBeNull()
})

it('keeps failed video jobs playable even when no poster exists', async () => {
  jest.mocked(useUploadProcessing).mockReturnValue({ pending: false, failed: true })
  const url = 'file:///video.mp4'
  const screen = await render(<MediaThumbnail url={url} />)
  expect(useVideoPlayer).toHaveBeenCalledWith({ uri: url }, expect.any(Function))
  expect(screen.queryByText('media.processingFailed')).toBeNull()
})

it('keeps the processing placeholder while conversion is pending', async () => {
  jest.mocked(useUploadProcessing).mockReturnValue({ pending: true, failed: false })
  const screen = await render(<MediaThumbnail url="/uploads/video.mp4" />)
  expect(screen.getByText('media.processing')).toBeTruthy()
})
