import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPost, fetchGroupMembers, fetchMyCircles, getGroupMediaAlbums, uploadFiles } from '@famlin/api-client'
import { NewPostModal } from '../NewPostModal'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  createPost: vi.fn(),
  fetchGroupMembers: vi.fn(),
  fetchMyCircles: vi.fn(),
  getGroupMediaAlbums: vi.fn(),
  uploadFiles: vi.fn(),
}))
const groups = [
  { id: 'one', name: 'Family', chitchatEnabled: false, createdAt: '2026-01-01' },
  { id: 'two', name: 'Relatives', chitchatEnabled: false, createdAt: '2026-01-01' },
]
const member = (id: string, name: string) => ({ id, name, email: `${id}@example.com`, joinedAt: '2026-01-01' })
const coverUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg'
const open = (onClose = vi.fn()) =>
  renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="one" onClose={onClose} />)
async function chooseTrip() {
  await userEvent.click(screen.getByRole('combobox', { name: 'What do you want to share?' }))
  await userEvent.click(screen.getByRole('option', { name: 'Trip' }))
  await userEvent.type(screen.getByPlaceholderText('E.g. Road trip Italy'), 'Italy')
  fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-07-01' } })
}
beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ user: makeUser({ id: 'self' }) })
  vi.mocked(createPost).mockResolvedValue({ id: 'trip' } as never)
  vi.mocked(fetchGroupMembers).mockImplementation(async (id) =>
    id === 'one'
      ? [member('self', 'Me'), member('anna', 'Anna'), member('bob', 'Bob')]
      : [member('self', 'Me'), member('anna', 'Anna')]
  )
  vi.mocked(fetchMyCircles).mockResolvedValue([])
  vi.mocked(getGroupMediaAlbums).mockResolvedValue([])
  vi.mocked(uploadFiles).mockResolvedValue([coverUrl])
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:trip-cover')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  useAuthStore.setState({ user: null })
  vi.restoreAllMocks()
})

it('requires a title and start date and creates a minimal trip without uploading unrelated media', async () => {
  const onClose = vi.fn()
  open(onClose)
  await userEvent.click(screen.getByRole('combobox', { name: 'What do you want to share?' }))
  await userEvent.click(screen.getByRole('option', { name: 'Trip' }))
  expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  await userEvent.type(screen.getByPlaceholderText('E.g. Road trip Italy'), 'Italy')
  expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-07-01' } })
  await userEvent.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(uploadFiles).not.toHaveBeenCalled()
  expect(createPost).toHaveBeenCalledWith({
    groupId: 'one',
    groupIds: undefined,
    circleId: undefined,
    type: 'TRIP',
    typeData: {
      title: 'Italy',
      destination: undefined,
      startDate: '2026-07-01',
      endDate: undefined,
      coverPhotoUrl: undefined,
      travelerUserIds: undefined,
    },
    uploadedAssetUrls: [],
  })
})

it('validates date order and clears the end date when the start moves past it', async () => {
  open()
  await chooseTrip()
  const end = screen.getByLabelText('End date')
  expect(end).toHaveAttribute('min', '2026-07-01')
  fireEvent.change(end, { target: { value: '2026-06-30' } })
  expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  fireEvent.change(end, { target: { value: '2026-07-02' } })
  expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Start date *'), { target: { value: '2026-07-03' } })
  expect(end).toHaveValue('')
})

it('uploads a cover and scopes a trip to a circle', async () => {
  vi.mocked(fetchMyCircles).mockResolvedValue([
    { id: 'circle', name: 'Close family', groupId: 'one', createdAt: '2026-01-01', memberCount: 1 },
  ])
  const { unmount } = open()
  await chooseTrip()
  await userEvent.click(await screen.findByRole('radio', { name: 'Close family' }))
  await userEvent.type(screen.getByPlaceholderText('E.g. Tuscany & Emilia-Romagna, Italy'), 'Tuscany')
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-10' } })
  const file = new File(['photo'], 'cover.jpg', { type: 'image/jpeg' })
  await userEvent.upload(screen.getByLabelText('Add cover photo'), file)
  expect(await screen.findByRole('img', { name: 'cover.jpg' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() =>
    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        circleId: 'circle',
        typeData: expect.objectContaining({ destination: 'Tuscany', endDate: '2026-07-10', coverPhotoUrl: coverUrl }),
      })
    )
  )
  expect(uploadFiles).toHaveBeenCalledWith([file])
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:trip-cover')
})

it('retains only companions belonging to every selected family and excludes the author', async () => {
  open()
  await chooseTrip()
  expect(screen.queryByRole('button', { name: 'Me' })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: 'Anna' }))
  await userEvent.click(screen.getByRole('button', { name: 'Bob' }))
  await userEvent.click(screen.getByRole('button', { name: 'Relatives' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Bob' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Anna' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() =>
    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        groupIds: ['one', 'two'],
        typeData: expect.objectContaining({ travelerUserIds: ['anna'] }),
      })
    )
  )
})

it('shows retry for companion load errors and preserves the form after upload failure', async () => {
  vi.mocked(fetchGroupMembers).mockRejectedValue(new Error('offline'))
  vi.mocked(uploadFiles).mockRejectedValue(new Error('upload failed'))
  const onClose = vi.fn()
  open(onClose)
  await chooseTrip()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load travel companions.')
  vi.mocked(fetchGroupMembers).mockResolvedValue([member('anna', 'Anna')])
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('button', { name: 'Anna' })).toBeInTheDocument()
  await userEvent.upload(
    screen.getByLabelText('Add cover photo'),
    new File(['photo'], 'cover.jpg', { type: 'image/jpeg' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByText("Your post couldn't be created. Try again.")).toBeInTheDocument()
  expect(createPost).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByPlaceholderText('E.g. Road trip Italy')).toHaveValue('Italy')
})

it('does not offer trips when the selected family disallows them', async () => {
  renderWithQueryClient(
    <NewPostModal groups={[{ ...groups[0], allowedPostTypes: ['UPDATE'] }]} defaultGroupId="one" onClose={vi.fn()} />
  )
  await userEvent.click(screen.getByRole('combobox', { name: 'What do you want to share?' }))
  expect(screen.queryByRole('option', { name: 'Trip' })).not.toBeInTheDocument()
})

it('shows one Update-style cover preview and restores the picker only after removal', async () => {
  open()
  await chooseTrip()
  const user = userEvent.setup()
  const input = screen.getByLabelText('Add cover photo') as HTMLInputElement
  expect(input.hidden).toBe(true)
  expect(input.multiple).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Add photos' }))
  const cover = new File(['photo'], 'cover.jpg', { type: 'image/jpeg' })
  await user.upload(input, cover)
  const image = await screen.findByRole('img', { name: 'cover.jpg' })
  expect(image.parentElement).toHaveClass('photo-preview')
  const remove = screen.getByRole('button', { name: 'Remove photo' })
  expect(remove).toHaveClass('photo-preview-remove')
  expect(image.parentElement).toContainElement(remove)
  expect(screen.queryByRole('button', { name: 'Add photos' })).not.toBeInTheDocument()
  await user.upload(input, new File(['other'], 'other.jpg', { type: 'image/jpeg' }))
  expect(screen.getByRole('img', { name: 'cover.jpg' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'other.jpg' })).not.toBeInTheDocument()
  await user.click(remove)
  expect(screen.queryByRole('img', { name: 'cover.jpg' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add photos' }))
  await user.upload(input, cover)
  expect(await screen.findByRole('img', { name: 'cover.jpg' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add photos' })).not.toBeInTheDocument()
})
