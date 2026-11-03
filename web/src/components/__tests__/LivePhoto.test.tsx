import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQueryClient } from '@/test/fixtures'
import { LivePhoto } from '../LivePhoto'

let intersection: IntersectionObserverCallback
let play: ReturnType<typeof vi.spyOn>
let pause: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const intersect = async (visible: boolean) => {
  await act(async () =>
    intersection([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver)
  )
}

it('starts only through the Live Photo icon and stops when scrolled away', async () => {
  const user = userEvent.setup()
  const open = vi.fn()
  const { container } = renderWithQueryClient(
    <LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" onClick={open} />
  )
  const video = container.querySelector('video')!
  const image = container.querySelector('img')!
  expect(image).toHaveAttribute('src', '/uploads/photo.jpg')
  expect(video).toHaveAttribute('loop')
  expect(video.muted).toBe(true)
  expect(video).toHaveAttribute('playsinline')
  expect(video).not.toHaveAttribute('controls')
  expect(video).not.toHaveAttribute('src')
  await intersect(true)
  expect(play).not.toHaveBeenCalled()
  expect(video).not.toHaveAttribute('src')
  await user.click(screen.getByRole('button', { name: 'Play Live Photo' }))
  await waitFor(() => expect(play).toHaveBeenCalled())
  expect(image).toHaveClass('live-photo-still-hidden')
  expect(video).not.toHaveClass('live-photo-motion-hidden')
  await user.click(screen.getByRole('button', { name: 'Pause Live Photo' }))
  expect(pause).toHaveBeenCalled()
  expect(image).not.toHaveClass('live-photo-still-hidden')
  expect(video).toHaveClass('live-photo-motion-hidden')
  expect(open).not.toHaveBeenCalled()
  play.mockClear()
  await user.click(screen.getByRole('button', { name: 'Play Live Photo' }))
  await waitFor(() => expect(play).toHaveBeenCalled())
  expect(image).toHaveClass('live-photo-still-hidden')
  expect(video).not.toHaveClass('live-photo-motion-hidden')
  pause.mockClear()
  await intersect(false)
  expect(pause).toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Live Photo' }))
  expect(open).toHaveBeenCalledTimes(1)
})

it('pauses on a hidden tab and resumes on return', async () => {
  renderWithQueryClient(<LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />)
  await intersect(true)
  await userEvent.click(screen.getByRole('button', { name: 'Play Live Photo' }))
  pause.mockClear()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(pause).toHaveBeenCalled()
  play.mockClear()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(play).toHaveBeenCalled())
})

it('stops a Live Photo when another video starts, without restarting it when that video pauses', async () => {
  const { container } = renderWithQueryClient(
    <LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />
  )
  await intersect(true)
  await userEvent.click(screen.getByRole('button', { name: 'Play Live Photo' }))
  await waitFor(() => expect(container.querySelector('img')).toHaveClass('live-photo-still-hidden'))
  const other = document.createElement('video')
  document.body.append(other)
  fireEvent.play(other)
  expect(screen.getByRole('button', { name: 'Play Live Photo' })).toHaveAttribute('aria-pressed', 'false')
  expect(container.querySelector('img')).not.toHaveClass('live-photo-still-hidden')
  play.mockClear()
  fireEvent.pause(other)
  expect(play).not.toHaveBeenCalled()
  other.remove()
})

it('autoplays in a lightbox and pauses the previous media when switching', async () => {
  const { container, rerender } = renderWithQueryClient(
    <LivePhoto key="first" imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" autoPlay />
  )
  const firstVideo = container.querySelector('video')!
  await intersect(true)
  await waitFor(() => expect(play.mock.instances).toContain(firstVideo))
  pause.mockClear()
  rerender(<LivePhoto key="second" imageUrl="/uploads/next.jpg" videoUrl="/uploads/next.mp4" autoPlay />)
  expect(pause.mock.instances).toContain(firstVideo)
  play.mockClear()
  await intersect(true)
  await waitFor(() => expect(play.mock.instances).toContain(container.querySelector('video')))
})

it('plays on desktop hover and stops when the pointer leaves', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  )
  const { container } = renderWithQueryClient(
    <LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />
  )
  await intersect(true)
  expect(play).not.toHaveBeenCalled()
  fireEvent.mouseEnter(container.querySelector('.live-photo')!)
  await waitFor(() => expect(play).toHaveBeenCalled())
  pause.mockClear()
  fireEvent.mouseLeave(container.querySelector('.live-photo')!)
  expect(pause).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Play Live Photo' })).toBeInTheDocument()
})

it('keeps touch layouts paused on pointer entry', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  )
  const { container } = renderWithQueryClient(
    <LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />
  )
  await intersect(true)
  fireEvent.mouseEnter(container.querySelector('.live-photo')!)
  expect(play).not.toHaveBeenCalled()
})

it('keeps autoplay independent of desktop hover, including after a manual pause', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  )
  const { container } = renderWithQueryClient(
    <LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" autoPlay />
  )
  await intersect(true)
  await waitFor(() => expect(play).toHaveBeenCalled())
  pause.mockClear()
  const photo = container.querySelector('.live-photo')!
  fireEvent.mouseEnter(photo)
  fireEvent.mouseLeave(photo)
  expect(pause).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Pause Live Photo' })).toBeInTheDocument()
  // Keyboard activation avoids synthesizing mouse hover in this assertion.
  fireEvent.click(screen.getByRole('button', { name: 'Pause Live Photo' }))
  play.mockClear()
  fireEvent.mouseEnter(photo)
  fireEvent.mouseLeave(photo)
  expect(play).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Play Live Photo' })).toBeInTheDocument()
})
