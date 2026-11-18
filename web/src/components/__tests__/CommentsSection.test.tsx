import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommentsSection } from '@/components/CommentsSection'
import { makeComment, makePost, renderWithQueryClient } from '@/test/fixtures'
import { api, createComment, fetchComments, fetchCommentsPage, type Comment } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchComments: vi.fn(),
  fetchCommentsPage: vi.fn(),
  createComment: vi.fn(),
  reactToComment: vi.fn().mockResolvedValue({ myReaction: 'LIKE', counts: { LIKE: 1 } }),
}))

// The paged thread (issue #130) as a single, final page.
function mockThread(comments: Comment[]) {
  vi.mocked(fetchCommentsPage).mockResolvedValue({ items: comments, nextCursor: null })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommentsSection', () => {
  it('lists comments with replies indented under their parent', async () => {
    mockThread([
      makeComment({ id: 'c1', content: 'First!' }),
      makeComment({
        id: 'c2',
        content: 'A reply',
        parentId: 'c1',
        author: { id: 'u3', name: 'Rita', avatarUrl: null },
      }),
    ])
    renderWithQueryClient(<CommentsSection post={makePost()} />)

    expect(await screen.findByText('First!')).toBeInTheDocument()
    expect(screen.getByText('A reply').closest('.comment')).toHaveClass('comment-reply')
  })

  it('shows an empty hint when there are no comments', async () => {
    mockThread([])
    renderWithQueryClient(<CommentsSection post={makePost()} />)
    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument()
  })

  it('submits a new comment and appends it', async () => {
    const user = userEvent.setup()
    mockThread([])
    vi.mocked(createComment).mockResolvedValue(makeComment({ id: 'new', content: 'Hello family' }))

    renderWithQueryClient(<CommentsSection post={makePost()} />)
    await user.type(await screen.findByPlaceholderText('Write a comment…'), 'Hello family')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(createComment).toHaveBeenCalledWith('post-1', { content: 'Hello family' })
    expect(await screen.findByText('Hello family')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText('Write a comment…')).toHaveValue(''))
  })

  it('disables send for an empty draft', async () => {
    mockThread([])
    renderWithQueryClient(<CommentsSection post={makePost()} />)
    expect(await screen.findByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('renders a photo attachment on a comment', async () => {
    mockThread([makeComment({ id: 'c1', content: '', attachmentUrl: '/uploads/photo.jpg' })])
    renderWithQueryClient(<CommentsSection post={makePost()} />)

    expect(await screen.findByRole('button', { name: 'View attachment' })).toBeInTheDocument()
  })

  it('uploads a picked photo and sends the comment with its attachmentUrls', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview')
    URL.revokeObjectURL = vi.fn()
    const uploadSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { urls: ['/uploads/new-photo.jpg'] } })
    const user = userEvent.setup()
    mockThread([])
    vi.mocked(createComment).mockResolvedValue(makeComment({ id: 'new', attachmentUrls: ['/uploads/new-photo.jpg'] }))

    const { container } = renderWithQueryClient(<CommentsSection post={makePost()} />)
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    expect(await screen.findByRole('button', { name: 'Remove attachment' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(uploadSpy).toHaveBeenCalled())
    expect(createComment).toHaveBeenCalledWith('post-1', {
      content: undefined,
      attachmentUrls: ['/uploads/new-photo.jpg'],
    })
  })

  it('stages several picked photos and sends them as one comment', async () => {
    let previewId = 0
    URL.createObjectURL = vi.fn(() => `blob:mock-preview-${previewId++}`)
    URL.revokeObjectURL = vi.fn()
    const uploadSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { urls: ['/uploads/a.jpg', '/uploads/b.jpg'] } })
    const user = userEvent.setup()
    mockThread([])
    vi.mocked(createComment).mockResolvedValue(
      makeComment({ id: 'new', content: '', attachmentUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] })
    )

    const { container } = renderWithQueryClient(<CommentsSection post={makePost()} />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, [
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['y'], 'b.jpg', { type: 'image/jpeg' }),
    ])

    expect(await screen.findAllByRole('button', { name: 'Remove attachment' })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(uploadSpy).toHaveBeenCalled())
    // One upload request for the batch, one comment carrying both photos.
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(createComment).toHaveBeenCalledWith('post-1', {
      content: undefined,
      attachmentUrls: ['/uploads/a.jpg', '/uploads/b.jpg'],
    })
  })

  it('bundles consecutive photo-only comments from the same author into one card', async () => {
    mockThread([
      makeComment({ id: 'c1', content: '', attachmentUrls: ['/uploads/a.jpg'], createdAt: '2026-07-08T11:00:00Z' }),
      makeComment({ id: 'c2', content: '', attachmentUrls: ['/uploads/b.jpg'], createdAt: '2026-07-08T11:01:00Z' }),
      makeComment({ id: 'c3', content: '', attachmentUrls: ['/uploads/c.jpg'], createdAt: '2026-07-08T11:02:00Z' }),
    ])
    const { container } = renderWithQueryClient(<CommentsSection post={makePost()} />)

    await waitFor(() => expect(container.querySelectorAll('.comment')).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: 'View attachment' })).toHaveLength(3)
    expect(screen.getByText('3 photos')).toBeInTheDocument()
  })

  it('keeps a photo comment that has text on its own card', async () => {
    mockThread([
      makeComment({ id: 'c1', content: '', attachmentUrls: ['/uploads/a.jpg'], createdAt: '2026-07-08T11:00:00Z' }),
      makeComment({
        id: 'c2',
        content: 'Look!',
        attachmentUrls: ['/uploads/b.jpg'],
        createdAt: '2026-07-08T11:01:00Z',
      }),
    ])
    const { container } = renderWithQueryClient(<CommentsSection post={makePost()} />)

    await waitFor(() => expect(container.querySelectorAll('.comment')).toHaveLength(2))
    expect(screen.getByText('Look!')).toBeInTheDocument()
  })

  // filterComments backs TripDetailPage's "Reacties op de reis" section,
  // which must never surface check-in comments (metadata.kind ===
  // 'trip_checkin') or their replies — see web's TripDetailPage.tsx.
  it('excludes comments (and their replies) that filterComments removes', async () => {
    mockThread([
      makeComment({
        id: 'checkin-1',
        content: 'Arrived in Bologna!',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [], checkinId: 'checkin-1' },
      }),
      makeComment({ id: 'checkin-reply', content: 'Nice!', parentId: 'checkin-1' }),
      makeComment({ id: 'trip-comment', content: 'Have a great trip!' }),
    ])
    renderWithQueryClient(
      <CommentsSection
        post={makePost()}
        filterComments={(all) => all.filter((c) => c.metadata?.kind !== 'trip_checkin')}
      />
    )

    expect(await screen.findByText('Have a great trip!')).toBeInTheDocument()
    expect(screen.queryByText('Arrived in Bologna!')).not.toBeInTheDocument()
    expect(screen.queryByText('Nice!')).not.toBeInTheDocument()
  })

  it('pages newest-first and loads older comments on request', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCommentsPage)
      .mockResolvedValueOnce({
        items: [makeComment({ id: 'c2', content: 'Newer', createdAt: '2026-07-25T11:00:00.000Z' })],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [makeComment({ id: 'c1', content: 'Older', createdAt: '2026-07-25T10:00:00.000Z' })],
        nextCursor: null,
      })
    renderWithQueryClient(<CommentsSection post={makePost()} />)

    expect(await screen.findByText('Newer')).toBeInTheDocument()
    expect(screen.queryByText('Older')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load older comments' }))

    const older = await screen.findByText('Older')
    expect(fetchCommentsPage).toHaveBeenLastCalledWith('post-1', { cursor: 'cursor-1' })
    // Display order stays oldest-first, and the button goes once it's all in.
    expect(older.compareDocumentPosition(screen.getByText('Newer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load older comments' })).not.toBeInTheDocument()
  })

  it('reads the whole thread from the flat cache with fullThread', async () => {
    vi.mocked(fetchComments).mockResolvedValue([makeComment({ id: 'c1', content: 'Whole thread' })])
    renderWithQueryClient(<CommentsSection post={makePost()} fullThread />)

    expect(await screen.findByText('Whole thread')).toBeInTheDocument()
    expect(fetchComments).toHaveBeenCalledWith('post-1')
    expect(fetchCommentsPage).not.toHaveBeenCalled()
  })
})
