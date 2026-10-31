import { render } from '@testing-library/react-native'
import { useVideoPlayer } from 'expo-video'
import { MediaThumbnail } from '../MediaThumbnail'
import { useUploadProcessing } from '@/hooks/useUploadProcessing'

jest.mock('@/hooks/useUploadProcessing', () => ({ useUploadProcessing: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('../Icon', () => ({ Icon: 'Icon' }))
jest.mock('../LivePhotoMedia', () => ({ LivePhotoMedia: 'LivePhotoMedia' }))
jest.mock('expo-image', () => ({ Image: 'Image' }))
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: 'VideoView' }))

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
