import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkInTrip, uploadFiles } from '@famlin/api-client'
import { TripCheckinModal } from '../TripCheckinModal'
import { makePost, makeTrip, renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  checkInTrip: vi.fn(),
  uploadFiles: vi.fn(),
}))
const url = '/uploads/11111111-1111-4111-8111-111111111111.jpg'
const open = (onClose = vi.fn()) =>
  renderWithQueryClient(<TripCheckinModal postId="trip-1" tripTitle="Italy" dayNumber={4} onClose={onClose} />)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkInTrip).mockResolvedValue(makePost({ id: 'trip-1', trip: makeTrip({ stopCount: 3 }) }))
  vi.mocked(uploadFiles).mockImplementation(async (files) => files.map(() => url))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:checkin')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('requires a place and submits trimmed text without requiring photos', async () => {
  const onClose = vi.fn()
  const { queryClient } = open(onClose)
  const previous = makePost({ id: 'trip-1', trip: makeTrip({ stopCount: 2 }) })
  queryClient.setQueryData(['post', 'trip-1'], previous)
  queryClient.setQueryData(['posts'], { pages: [{ items: [previous], nextCursor: null }], pageParams: [undefined] })
  queryClient.setQueryData(['favorites'], { pages: [{ items: [previous], nextCursor: null }], pageParams: [undefined] })
  const user = userEvent.setup()
  const submit = screen.getByRole('button', { name: 'Check in' })
  expect(submit).toBeDisabled()
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), '  Bologna  ')
  await user.type(screen.getByRole('textbox', { name: /Tell something/ }), '  Great stop  ')
  await user.click(submit)
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(checkInTrip).toHaveBeenCalledWith('trip-1', { place: 'Bologna', text: 'Great stop', photoUrls: [] })
  expect(uploadFiles).not.toHaveBeenCalled()
  expect(queryClient.getQueryData(['post', 'trip-1'])).toMatchObject({ trip: { stopCount: 3 } })
  expect(queryClient.getQueryData(['posts'])).toMatchObject({ pages: [{ items: [{ trip: { stopCount: 3 } }] }] })
  expect(queryClient.getQueryData(['favorites'])).toMatchObject({ pages: [{ items: [{ trip: { stopCount: 3 } }] }] })
})

it('caps media at ten, supports removal and cleans up previews', async () => {
  const { unmount } = open()
  const user = userEvent.setup()
  const input = screen.getByLabelText('Photo / video')
  const files = Array.from({ length: 12 }, (_, i) => new File(['photo'], `photo-${i}.jpg`, { type: 'image/jpeg' }))
  await user.upload(input, files)
  expect(await screen.findAllByRole('img')).toHaveLength(10)
  expect(screen.queryByRole('button', { name: 'Photo / video' })).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'Remove photo' })[0])
  expect(screen.getAllByRole('img')).toHaveLength(9)
  expect(screen.getByRole('button', { name: 'Photo / video' })).toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), 'Bologna')
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  await waitFor(() => expect(checkInTrip).toHaveBeenCalled())
  expect(uploadFiles).toHaveBeenCalledWith(files.slice(1, 10))
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalled()
})

it('retains the draft after an API error and reuses uploaded paths on retry', async () => {
  const onClose = vi.fn()
  vi.mocked(checkInTrip).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(makePost())
  open(onClose)
  const user = userEvent.setup()
  await user.upload(screen.getByLabelText('Photo / video'), new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), 'Bologna')
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Check-in failed')
  expect(screen.getByPlaceholderText('E.g. Bologna')).toHaveValue('Bologna')
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(uploadFiles).toHaveBeenCalledOnce()
  expect(checkInTrip).toHaveBeenLastCalledWith('trip-1', { place: 'Bologna', text: undefined, photoUrls: [url] })
})

it('does not submit after an upload error and allows retry', async () => {
  vi.mocked(uploadFiles).mockRejectedValueOnce(new Error('offline'))
  open()
  const user = userEvent.setup()
  await user.upload(screen.getByLabelText('Photo / video'), new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), 'Bologna')
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Check-in failed')
  expect(checkInTrip).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  await waitFor(() => expect(checkInTrip).toHaveBeenCalledOnce())
})

it('blocks dismissal and duplicate submission during upload', async () => {
  let resolve!: (urls: string[]) => void
  vi.mocked(uploadFiles).mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const onClose = vi.fn()
  open(onClose)
  const user = userEvent.setup()
  await user.upload(screen.getByLabelText('Photo / video'), new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), 'Bologna')
  await user.dblClick(screen.getByRole('button', { name: 'Check in' }))
  expect(uploadFiles).toHaveBeenCalledOnce()
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('dialog'))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  resolve([url])
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(checkInTrip).toHaveBeenCalledOnce()
})
