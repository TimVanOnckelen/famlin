import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addAlbumPhotos, createComment, fetchComments, uploadFilesInSession } from '@famlin/api-client'
import { ComposerUploadPreview } from '../ComposerUploadPreview'
import { AddAlbumPhotosModal } from '../AddAlbumPhotosModal'
import { CommentsSection } from '../CommentsSection'
import { useComposerUploads } from '@/hooks/useComposerUploads'
import { makeComment, makePost, renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  uploadFilesInSession: vi.fn(),
  addAlbumPhotos: vi.fn(),
  createComment: vi.fn(),
  fetchComments: vi.fn(),
}))
const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg'
const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4'
const response = {
  urls: [photoUrl],
  sessionMedia: [{ url: photoUrl, kind: 'image' as const, status: 'queued' as const, thumbnailUrl: null }],
}
const photo = () => new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${(file as File).name}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(fetchComments).mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

for (const kind of ['album', 'comment'] as const) {
  it(`${kind}: uploads on selection, blocks submit during transfer and reuses URLs after publish failure`, async () => {
    const request = deferred<typeof response>()
    vi.mocked(uploadFilesInSession).mockReturnValue(request.promise)
    vi.mocked(addAlbumPhotos).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(makePost())
    vi.mocked(createComment).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(makeComment())
    const onClose = vi.fn(),
      user = userEvent.setup()
    const { container } = renderWithQueryClient(
      kind === 'album' ? (
        <AddAlbumPhotosModal postId="post-1" onClose={onClose} />
      ) : (
        <CommentsSection post={makePost()} />
      )
    )
    const file = photo()
    await user.upload(container.querySelector('input[type="file"]')!, file)
    expect(uploadFilesInSession).toHaveBeenCalledWith([file], expect.any(String), [])
    const button = screen.getByRole('button', { name: kind === 'album' ? 'Add to album' : 'Send' })
    expect(button).toBeDisabled()
    expect(kind === 'album' ? addAlbumPhotos : createComment).not.toHaveBeenCalled()
    await act(async () => request.resolve(response))
    expect(await screen.findByAltText(file.name)).toHaveAttribute('src', expect.stringContaining('-thumbnail.jpg'))
    await user.click(button)
    await screen.findByText(
      kind === 'album' ? "Your photos couldn't be added. Try again." : "Your comment couldn't be posted. Try again."
    )
    await user.click(button)
    if (kind === 'album') await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    else await waitFor(() => expect(createComment).toHaveBeenCalledTimes(2))
    expect(uploadFilesInSession).toHaveBeenCalledOnce()
    expect(kind === 'album' ? addAlbumPhotos : createComment).toHaveBeenLastCalledWith(
      'post-1',
      kind === 'album'
        ? { photoUrls: [photoUrl], caption: undefined }
        : { attachmentUrls: [photoUrl], content: undefined }
    )
  })
}

it('retries failed uploads while retaining the selected attachment', async () => {
  vi.mocked(uploadFilesInSession).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response)
  const { result } = renderHook(() => useComposerUploads(10))
  const file = photo()
  await act(async () => {
    await result.current.add([file])
  })
  expect(result.current.error).toBe(true)
  expect(result.current.items).toHaveLength(1)
  await act(async () => {
    await result.current.retry()
  })
  expect(result.current.error).toBe(false)
  expect(result.current.urls).toEqual([photoUrl])
  expect(vi.mocked(uploadFilesInSession).mock.calls[0][1]).toBe(vi.mocked(uploadFilesInSession).mock.calls[1][1])
})

it('does not restore a removed Live Photo when its upload completes late', async () => {
  const request = deferred<{ urls: string[]; sessionMedia: never[] }>()
  vi.mocked(uploadFilesInSession).mockReturnValueOnce(request.promise).mockResolvedValue({ urls: [], sessionMedia: [] })
  const { result } = renderHook(() => useComposerUploads(10))
  let pending!: Promise<void>
  act(() => {
    pending = result.current.add([photo(), new File(['v'], 'IMG_1.mov', { type: 'video/quicktime' })])
  })
  expect(result.current.items).toHaveLength(1)
  await act(async () => {
    await result.current.remove(result.current.items[0])
  })
  expect(result.current.items).toHaveLength(0)
  await act(async () => {
    request.resolve({ urls: [photoUrl, videoUrl], sessionMedia: [] })
    await pending
  })
  expect(result.current.urls).toEqual([])
  expect(uploadFilesInSession).toHaveBeenLastCalledWith([], expect.any(String), [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ])
})

it('keeps a confirmed Live Photo as one attachment and excludes both parts on removal', async () => {
  vi.mocked(uploadFilesInSession)
    .mockResolvedValueOnce({
      urls: [photoUrl, videoUrl],
      sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: null }],
    })
    .mockResolvedValue({ urls: [], sessionMedia: [] })
  const { result, unmount } = renderHook(() => useComposerUploads(10))
  await act(async () => {
    await result.current.add([photo(), new File(['v'], 'IMG_1.mov', { type: 'video/quicktime' })])
  })
  expect(result.current.items).toHaveLength(1)
  expect(result.current.urls).toEqual([photoUrl])
  await act(async () => {
    await result.current.remove(result.current.items[0])
  })
  expect(result.current.items).toHaveLength(0)
  expect(uploadFilesInSession).toHaveBeenLastCalledWith([], expect.any(String), [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ])
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalled()
})

it('keeps same-name photo and video separate when the server does not confirm a Live Photo', async () => {
  vi.mocked(uploadFilesInSession).mockResolvedValue({ urls: [photoUrl, videoUrl], sessionMedia: [] })
  const { result } = renderHook(() => useComposerUploads(10))
  await act(async () => {
    await result.current.add([photo(), new File(['v'], 'IMG_1.mov', { type: 'video/quicktime' })])
  })
  expect(result.current.items).toHaveLength(2)
  expect(result.current.urls).toEqual([photoUrl, videoUrl])
})

it('retains retry for an earlier failed attachment after another successful selection', async () => {
  vi.mocked(uploadFilesInSession).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response)
  const { result } = renderHook(() => useComposerUploads(10))
  await act(async () => {
    await result.current.add([photo()])
  })
  await act(async () => {
    await result.current.add([new File(['x'], 'other.jpg', { type: 'image/jpeg' })])
  })
  expect(result.current.error).toBe(true)
  expect(result.current.incomplete).toBe(true)
  await act(async () => {
    await result.current.retry()
  })
  expect(result.current.error).toBe(false)
  expect(result.current.incomplete).toBe(false)
  expect(vi.mocked(uploadFilesInSession).mock.calls[2][0]).toHaveLength(1)
})

for (const kind of ['image', 'video', 'livePhoto'] as const) {
  it(`uses the post composer's static thumbnail for ${kind}`, () => {
    const file = kind === 'video' ? new File(['v'], 'clip.mov', { type: 'video/quicktime' }) : photo()
    const url = kind === 'video' ? videoUrl : photoUrl
    const { container } = renderWithQueryClient(
      <ComposerUploadPreview item={{ file, previewUrl: '', url }} livePhoto={kind === 'livePhoto'} />
    )
    expect(screen.getByAltText(file.name)).toHaveAttribute('src', expect.stringContaining('-thumbnail.jpg'))
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })
}
