import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PostCard } from '@/components/PostCard'
import { makePost, makeUser, renderWithQueryClient } from '@/test/fixtures'
import { useAuthStore } from '@/stores/authStore'
import { deletePost, fetchComments, updatePost, uploadFiles } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchComments: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  uploadFiles: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}))

// The post fixture is authored by user-1.
function signInAs(overrides: Parameters<typeof makeUser>[0] = {}) {
  useAuthStore.setState({ user: makeUser(overrides), token: 'token', isLoading: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchComments).mockResolvedValue([])
})

afterEach(() => {
  useAuthStore.setState({ user: null, token: null })
})

describe('post edit/delete actions', () => {
  it('offers edit and delete to the author in the detail view', () => {
    signInAs({ id: 'user-1' })
    renderWithQueryClient(<PostCard post={makePost()} showComments />)
    expect(screen.getByRole('button', { name: 'Edit post' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument()
  })

  it("offers them to an admin on someone else's post", () => {
    signInAs({ id: 'admin-1', isAdmin: true })
    renderWithQueryClient(<PostCard post={makePost()} showComments />)
    expect(screen.getByRole('button', { name: 'Edit post' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument()
  })

  it("hides them from a regular member on someone else's post", () => {
    signInAs({ id: 'user-2' })
    renderWithQueryClient(<PostCard post={makePost()} showComments />)
    expect(screen.queryByRole('button', { name: 'Edit post' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
  })

  it('keeps them off feed cards, even for the author', () => {
    signInAs({ id: 'user-1' })
    renderWithQueryClient(<PostCard post={makePost()} />)
    expect(screen.queryByRole('button', { name: 'Edit post' })).not.toBeInTheDocument()
  })

  it('deletes only after confirmation, then reports back', async () => {
    signInAs({ id: 'user-1' })
    vi.mocked(deletePost).mockResolvedValue()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    renderWithQueryClient(<PostCard post={makePost({ id: 'post-9' })} showComments onDeleted={onDeleted} />)

    await user.click(screen.getByRole('button', { name: 'Delete post' }))
    expect(deletePost).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete post' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(deletePost).toHaveBeenCalledWith('post-9')
    confirmSpy.mockRestore()
  })

  it('edits the text, drops a removed photo and uploads a new one', async () => {
    signInAs({ id: 'user-1' })
    const post = makePost({ id: 'post-3', uploadedAssetUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] })
    vi.mocked(uploadFiles).mockResolvedValue(['/uploads/c.jpg'])
    vi.mocked(updatePost).mockResolvedValue({ ...post, content: 'Fixed typo' })
    const user = userEvent.setup()
    renderWithQueryClient(<PostCard post={post} showComments />)

    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit post' })
    const textarea = screen.getByRole('textbox', { name: 'Post text' })
    expect(textarea).toHaveValue('Lovely day in the garden.')
    await user.clear(textarea)
    await user.type(textarea, 'Fixed typo')

    // Remove the second existing photo.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' })
    await user.click(removeButtons[1])

    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    await user.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, file)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePost).toHaveBeenCalledWith('post-3', {
        content: 'Fixed typo',
        uploadedAssetUrls: ['/uploads/a.jpg', '/uploads/c.jpg'],
      })
    )
    expect(uploadFiles).toHaveBeenCalledWith([file])
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit post' })).not.toBeInTheDocument())
  })

  it("won't save a post left with neither text nor photos", async () => {
    signInAs({ id: 'user-1' })
    const user = userEvent.setup()
    renderWithQueryClient(<PostCard post={makePost()} showComments />)

    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    await user.clear(screen.getByRole('textbox', { name: 'Post text' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
