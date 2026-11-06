import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AvatarCropModal } from '../AvatarCropModal'
import { convertAvatarForPreview } from '@/utils/avatar-conversion'
import { prepareAvatar } from '@/utils/avatar-image'

vi.mock('@/utils/avatar-image', async (original) => ({
  ...(await original<typeof import('@/utils/avatar-image')>()),
  prepareAvatar: vi.fn(),
}))

vi.mock('@/utils/avatar-conversion', async (original) => ({
  ...(await original<typeof import('@/utils/avatar-conversion')>()),
  convertAvatarForPreview: vi.fn(),
}))

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:crop'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.clearAllMocks())

function load() {
  const image = screen.getByAltText('Profile photo preview')
  Object.defineProperties(image, { naturalWidth: { value: 4000 }, naturalHeight: { value: 3000 } })
  fireEvent.load(image)
  return image
}

it('only prepares a confirmed crop and exposes zoom buttons instead of sliders', async () => {
  const onSave = vi.fn()
  const user = userEvent.setup()
  const result = new File(['small jpeg'], 'avatar.jpg', { type: 'image/jpeg' })
  vi.mocked(prepareAvatar).mockResolvedValue(result)
  const { unmount } = render(
    <AvatarCropModal file={new File(['4k original'], 'photo.png')} onClose={() => {}} onSave={onSave} />
  )
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  const image = load()
  expect(prepareAvatar).not.toHaveBeenCalled()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(result))
  expect(prepareAvatar).toHaveBeenCalledWith(image, { zoom: 2, x: 0, y: 0 })
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:crop')
})

it('cancels without processing and closes with Escape', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onSave = vi.fn()
  render(<AvatarCropModal file={new File(['photo'], 'photo.jpg')} onClose={onClose} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(onSave).not.toHaveBeenCalled()
  expect(prepareAvatar).not.toHaveBeenCalled()
})

it('shows a decoding error and prevents saving unsupported images', () => {
  render(<AvatarCropModal file={new File(['invalid'], 'photo.jpg')} onClose={() => {}} onSave={vi.fn()} />)
  fireEvent.error(screen.getByAltText('Profile photo preview'))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('does not save if cancelled while encoding', async () => {
  let complete!: (file: File) => void
  vi.mocked(prepareAvatar).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const onSave = vi.fn()
  const { unmount } = render(
    <AvatarCropModal file={new File(['photo'], 'photo.jpg')} onClose={() => {}} onSave={onSave} />
  )
  load()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  unmount()
  complete(new File(['jpeg'], 'avatar.jpg'))
  await Promise.resolve()
  expect(onSave).not.toHaveBeenCalled()
})

it('bounds zoom and keeps zoom-button pointer events out of the drag handler', async () => {
  const user = userEvent.setup()
  render(<AvatarCropModal file={new File(['photo'], 'photo.jpg')} onClose={() => {}} onSave={vi.fn()} />)
  const image = load()
  const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
  const zoomOut = screen.getByRole('button', { name: 'Zoom out' })
  const preview = image.parentElement!
  const capture = vi.fn()
  Object.assign(preview, { setPointerCapture: capture })
  for (let i = 0; i < 8; i++) await user.click(zoomIn)
  expect(zoomIn).toBeDisabled()
  expect(zoomOut).toBeEnabled()
  expect(capture).not.toHaveBeenCalled()
  for (let i = 0; i < 8; i++) await user.click(zoomOut)
  expect(zoomOut).toBeDisabled()
  expect(image.style.width).toBe('133.33333333333331%')
})

it('converts an undecodable HEIC through the API before enabling cropping', async () => {
  let complete!: (url: string) => void
  vi.mocked(convertAvatarForPreview).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const file = new File(['heic'], 'photo.HEIC', { type: 'image/heic' })
  const onSave = vi.fn()
  render(<AvatarCropModal file={file} onClose={() => {}} onSave={onSave} />)
  const image = screen.getByAltText('Profile photo preview')
  fireEvent.error(image)
  expect(convertAvatarForPreview).toHaveBeenCalledWith(file, expect.any(AbortSignal))
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  complete('/uploads/converted.jpg?token=media')
  await waitFor(() => expect(image).toHaveAttribute('src', '/uploads/converted.jpg?token=media'))
  load()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.error(image)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(convertAvatarForPreview).toHaveBeenCalledTimes(1)
})

it('aborts conversion polling when the crop editor is closed', () => {
  vi.mocked(convertAvatarForPreview).mockImplementation(() => new Promise(() => {}))
  const { unmount } = render(
    <AvatarCropModal file={new File(['heic'], 'photo.heic')} onClose={() => {}} onSave={vi.fn()} />
  )
  fireEvent.error(screen.getByAltText('Profile photo preview'))
  const signal = vi.mocked(convertAvatarForPreview).mock.calls[0][1]
  unmount()
  expect(signal.aborted).toBe(true)
})
