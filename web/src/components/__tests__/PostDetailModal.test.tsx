import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PostDetailModal } from '@/components/PostDetailModal'
import { makePost, makeTrip, renderWithQueryClient } from '@/test/fixtures'
import { fetchComments, fetchPost, fetchUploadProcessing } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchPost: vi.fn(),
  fetchUploadProcessing: vi.fn(),
  fetchComments: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchComments).mockResolvedValue([])
})

describe('PostDetailModal', () => {
  it('shows the post with its full comment thread', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7', commentCount: 0 }))
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={() => {}} />)

    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Write a comment…')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />)

    await screen.findByText('Lovely day in the garden.')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a backdrop click', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />)

    await screen.findByText('Lovely day in the garden.')
    await user.click(container.querySelector('.modal-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking inside the dialog', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />)

    await user.click(await screen.findByText('Lovely day in the garden.'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hands a trip permalink over to the trip page', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'trip-1', type: 'TRIP', trip: makeTrip() }))
    const onOpenTrip = vi.fn()
    renderWithQueryClient(<PostDetailModal postId="trip-1" onClose={() => {}} onOpenTrip={onOpenTrip} />)

    await vi.waitFor(() => expect(onOpenTrip).toHaveBeenCalledWith('trip-1'))
  })
})

it('autoplays Live Photo in the post media pane and stops when switching', async () => {
  const url = '/uploads/11111111-1111-4111-8111-111111111111.jpg'
  vi.mocked(fetchPost).mockResolvedValue(makePost({ uploadedAssetUrls: [url, '/uploads/next.jpg'] }))
  vi.mocked(fetchUploadProcessing).mockResolvedValue({
    status: 'ready',
    url,
    thumbnailUrl: null,
    kind: 'livePhoto',
    videoUrl: '/uploads/motion.mp4',
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  )
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const { container, unmount } = renderWithQueryClient(<PostDetailModal postId="post-7" onClose={() => {}} />)
  await waitFor(() => expect(container.querySelector('.post-detail-modal-media')).not.toBeNull())
  const mediaPane = container.querySelector<HTMLElement>('.post-detail-modal-media')!
  expect(await within(mediaPane).findByRole('button', { name: 'Pause Live Photo' })).toBeInTheDocument()
  const video = mediaPane.querySelector('video')!
  await waitFor(() => expect(play.mock.instances).toContain(video))
  pause.mockClear()
  await userEvent.click(screen.getByRole('button', { name: 'Next photo' }))
  expect(pause.mock.instances).toContain(video)
  unmount()
  pause.mockRestore()
  play.mockRestore()
  vi.unstubAllGlobals()
})

it('shows processing status over the preview in the media pane', async () => {
  const url = '/uploads/11111111-1111-4111-8111-111111111111.jpg'
  const thumbnailUrl = url.replace('.jpg', '-thumbnail.jpg')
  vi.mocked(fetchPost).mockResolvedValue(makePost({ uploadedAssetUrls: [url] }))
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'processing', url, thumbnailUrl })
  const { container } = renderWithQueryClient(<PostDetailModal postId="post-7" onClose={() => {}} />)
  await waitFor(() => expect(container.querySelector('.post-detail-modal-media')).not.toBeNull())
  const mediaPane = container.querySelector<HTMLElement>('.post-detail-modal-media')!
  const status = await within(mediaPane).findByRole('status')
  expect(status).toHaveTextContent('Media is processing…')
  await waitFor(() =>
    expect(status.querySelector('img')).toHaveAttribute('src', `http://localhost:3000${thumbnailUrl}`)
  )
  expect(mediaPane.querySelector('video')).toBeNull()
})
