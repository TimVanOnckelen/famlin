import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/fixtures';
import { LivePhoto } from '../LivePhoto';

let intersection: IntersectionObserverCallback;
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {} disconnect() {}
  });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const intersect = async (visible: boolean) => { await act(async () => intersection([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver)); };

it('loops silently while visible and pauses/resumes through the Live Photo icon', async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const { container } = renderWithQueryClient(<LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" onClick={open} />);
  const video = container.querySelector('video')!;
  const image = container.querySelector('img')!;
  expect(image).toHaveAttribute('src', '/uploads/photo.jpg');
  expect(video).toHaveAttribute('loop');
  expect(video.muted).toBe(true);
  expect(video).toHaveAttribute('playsinline');
  expect(video).not.toHaveAttribute('controls');
  expect(video).not.toHaveAttribute('src');
  await intersect(true);
  await waitFor(() => expect(play).toHaveBeenCalled());
  expect(image).toHaveClass('live-photo-still-hidden');
  expect(video).not.toHaveClass('live-photo-motion-hidden');
  await user.click(screen.getByRole('button', { name: 'Pause Live Photo' }));
  expect(pause).toHaveBeenCalled();
  expect(image).not.toHaveClass('live-photo-still-hidden');
  expect(video).toHaveClass('live-photo-motion-hidden');
  expect(open).not.toHaveBeenCalled();
  play.mockClear();
  await user.click(screen.getByRole('button', { name: 'Play Live Photo' }));
  await waitFor(() => expect(play).toHaveBeenCalled());
  expect(image).toHaveClass('live-photo-still-hidden');
  expect(video).not.toHaveClass('live-photo-motion-hidden');
  pause.mockClear();
  await intersect(false);
  expect(pause).toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Live Photo' }));
  expect(open).toHaveBeenCalledTimes(1);
});

it('pauses on a hidden tab and resumes on return', async () => {
  renderWithQueryClient(<LivePhoto imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />);
  await intersect(true);
  pause.mockClear();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(pause).toHaveBeenCalled();
  play.mockClear();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(play).toHaveBeenCalled());
});
