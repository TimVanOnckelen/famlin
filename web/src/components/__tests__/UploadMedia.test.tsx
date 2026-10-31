import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchUploadProcessing, getUploadUrl } from '@famlin/api-client'
import { renderWithQueryClient } from '@/test/fixtures'
import { UploadMedia } from '../UploadMedia'
import { PostCard } from '../PostCard'
import { Lightbox } from '../Lightbox'
import { makePost, createTestQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchUploadProcessing: vi.fn(),
}))
const url = '/uploads/11111111-1111-4111-8111-111111111111.mp4'
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('renders ready post media immediately without a status request, including after remount', () => {
  const key = '11111111-1111-4111-8111-111111111111'
  const post = makePost({
    uploadedAssetUrls: [url],
    uploadProcessing: {
      [key]: { status: 'ready', kind: 'video', url, thumbnailUrl: url.replace('.mp4', '-thumbnail.jpg') },
    },
  })
  const first = renderWithQueryClient(<PostCard post={post} />)
  expect(first.container.querySelector('.media-video-preview img')).not.toBeNull()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
  first.unmount()
  renderWithQueryClient(<PostCard post={post} />)
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
})

it('opens a failed video attachment using the original-file fallback without polling', async () => {
  renderWithQueryClient(
    <PostCard
      post={makePost({
        uploadedAssetUrls: [url],
        uploadProcessing: {
          '11111111-1111-4111-8111-111111111111': { status: 'failed', url, thumbnailUrl: null },
        },
      })}
    />
  )
  expect(screen.queryByText('Media processing failed')).not.toBeInTheDocument()
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Play video' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.querySelector('video')).toHaveAttribute('src', getUploadUrl(url))
})

it('uses a fresh ready post response even when the status cache still says processing', () => {
  const key = '11111111-1111-4111-8111-111111111111'
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['upload-processing', key], { status: 'processing', url, thumbnailUrl: null })
  const { container } = renderWithQueryClient(
    <PostCard
      post={makePost({
        uploadedAssetUrls: [url],
        uploadProcessing: { [key]: { status: 'ready', url, thumbnailUrl: null } },
      })}
    />,
    { queryClient }
  )
  expect(container.querySelector('.media-video-preview')).not.toBeNull()
  expect(screen.queryByText('Media is processing…')).not.toBeInTheDocument()
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
})

it('uses pending post metadata immediately and polls until ready', async () => {
  const thumbnailUrl = url.replace('.mp4', '-thumbnail.jpg')
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl })
  const { container } = renderWithQueryClient(
    <PostCard
      post={makePost({
        uploadedAssetUrls: [url],
        uploadProcessing: {
          '11111111-1111-4111-8111-111111111111': { status: 'queued', url, thumbnailUrl },
        },
      })}
    />
  )
  expect(screen.getByText('Media is processing…')).toBeInTheDocument()
  expect(container.querySelector('.media-processing img')).toHaveAttribute('src', getUploadUrl(thumbnailUrl))
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
  await waitFor(() => expect(container.querySelector('.media-video-preview')).not.toBeNull(), { timeout: 4000 })
  expect(fetchUploadProcessing).toHaveBeenCalledTimes(1)
})

it.each([1, 2])('shows a video poster and opens playback in the lightbox with %i attachments', async (count) => {
  const user = userEvent.setup()
  const thumbnailUrl = url.replace('.mp4', '-thumbnail.jpg')
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl })
  const { container } = renderWithQueryClient(
    <PostCard post={makePost({ uploadedAssetUrls: count === 1 ? [url] : [url, '/uploads/photo.jpg'] })} />
  )
  await waitFor(() =>
    expect(container.querySelector('.media-video-preview img')).toHaveAttribute('src', getUploadUrl(thumbnailUrl))
  )
  expect(container.querySelector('.media-video-play')).toBeInTheDocument()
  expect(container.querySelector('video')).toBeNull()
  await user.click(
    count === 1
      ? screen.getByRole('button', { name: 'Play video' })
      : container.querySelector<HTMLButtonElement>('.post-collage-tile')!
  )
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', getUploadUrl(url)))
  expect(dialog.querySelector('video')).toHaveAttribute('controls')
  expect(dialog.querySelector('video')).toHaveAttribute('autoplay')
})

it('keeps a video placeholder when its poster is missing without mounting an inline player', () => {
  const { container } = renderWithQueryClient(<UploadMedia url="/uploads/legacy.mp4" thumbnail />)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('.media-video-poster-missing')).toBeInTheDocument()
  expect(container.querySelector('.media-video-play')).toBeInTheDocument()
  expect(container.querySelector('video')).toBeNull()
})

it('uses the thumbnail for a processing single-photo post and the full photo once ready', async () => {
  const photoUrl = url.replace('.mp4', '.jpg')
  const thumbnailUrl = photoUrl.replace('.jpg', '-thumbnail.jpg')
  vi.mocked(fetchUploadProcessing)
    .mockResolvedValueOnce({ status: 'processing', url: photoUrl, thumbnailUrl })
    .mockResolvedValue({ status: 'ready', url: photoUrl, thumbnailUrl })
  const { container } = renderWithQueryClient(<PostCard post={makePost({ uploadedAssetUrls: [photoUrl] })} />)
  await screen.findByText('Media is processing…')
  await waitFor(() =>
    expect(container.querySelector('.post-hero > .media-processing img')).toHaveAttribute(
      'src',
      getUploadUrl(thumbnailUrl)
    )
  )
  expect(container.querySelector('.post-hero img[src="' + getUploadUrl(photoUrl) + '"]')).toBeNull()
  await waitFor(
    () =>
      expect(container.querySelector('.post-hero .shimmer-frame img')).toHaveAttribute('src', getUploadUrl(photoUrl)),
    { timeout: 4000 }
  )
})

it('shows processing with a preview, then replaces it with the ready video', async () => {
  vi.mocked(fetchUploadProcessing)
    .mockResolvedValueOnce({ status: 'queued', url, thumbnailUrl: url.replace('.mp4', '-thumbnail.jpg') })
    .mockResolvedValue({ status: 'ready', url, thumbnailUrl: url.replace('.mp4', '-thumbnail.jpg') })
  const { container } = renderWithQueryClient(<UploadMedia url={url} />)
  expect(await screen.findByText('Media is processing…')).toBeInTheDocument()
  expect(container.querySelector('video')).toBeNull()
  await waitFor(() => expect(container.querySelector('.media-processing img')).not.toBeNull())
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', getUploadUrl(url)), {
    timeout: 4000,
  })
  expect(screen.queryByText('Media is processing…')).not.toBeInTheDocument()
})

it('plays the original when video processing fails', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'failed', url, thumbnailUrl: null })
  const { container } = renderWithQueryClient(<UploadMedia url={url} />)
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', getUploadUrl(url)))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps the failure message for an unconvertible photo', async () => {
  const photoUrl = url.replace('.mp4', '.jpg')
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'failed', url: photoUrl, thumbnailUrl: null })
  const { container } = renderWithQueryClient(<UploadMedia url={photoUrl} />)
  expect(await screen.findByText('Media processing failed')).toBeInTheDocument()
  expect(container.querySelector('video')).toBeNull()
})

it('pauses an ordinary video when another player starts', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl: null })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const { container } = renderWithQueryClient(<UploadMedia url={url} />)
  await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
  const video = container.querySelector('video')!
  const other = document.createElement('video')
  document.body.append(other)
  fireEvent.play(other)
  expect(pause.mock.instances).toContain(video)
  other.remove()
  pause.mockRestore()
})

it('starts each lightbox video explicitly and stops the previous video when switching or closing', async () => {
  const next = url.replace('11111111', '22222222')
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl: null })
  const { container, unmount } = renderWithQueryClient(
    <Lightbox assetUrls={[url, next]} initialIndex={0} onClose={() => {}} />
  )
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  const first = container.querySelector('video')!
  vi.mocked(HTMLMediaElement.prototype.play).mockClear()
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear()
  await userEvent.click(screen.getByRole('button', { name: '›' }))
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', getUploadUrl(next)))
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.instances).toContain(first)
  expect(vi.mocked(HTMLMediaElement.prototype.play).mock.instances).toContain(container.querySelector('video'))
  const second = container.querySelector('video')!
  unmount()
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.instances).toContain(second)
})

it('retries lightbox autoplay muted when the browser blocks sound', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl: null })
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'))
  const { container } = renderWithQueryClient(<Lightbox assetUrls={[url]} initialIndex={0} onClose={() => {}} />)
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2))
  expect(container.querySelector('video')!.muted).toBe(true)
})
