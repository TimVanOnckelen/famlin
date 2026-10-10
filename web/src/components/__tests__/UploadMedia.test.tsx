import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchUploadProcessing, getUploadUrl } from '@famlin/api-client';
import { renderWithQueryClient } from '@/test/fixtures';
import { UploadMedia } from '../UploadMedia';
import { PostCard } from '../PostCard';
import { makePost } from '@/test/fixtures';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchUploadProcessing: vi.fn(),
}));
const url = '/uploads/11111111-1111-4111-8111-111111111111.mp4';
beforeEach(() => { vi.resetAllMocks(); });

it.each([1, 2])('shows a video poster and opens playback in the lightbox with %i attachments', async (count) => {
  const user = userEvent.setup();
  const thumbnailUrl = url.replace('.mp4', '-thumbnail.jpg');
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'ready', url, thumbnailUrl });
  const { container } = renderWithQueryClient(<PostCard post={makePost({ uploadedAssetUrls: count === 1 ? [url] : [url, '/uploads/photo.jpg'] })} />);
  await waitFor(() => expect(container.querySelector('.media-video-preview img'))
    .toHaveAttribute('src', getUploadUrl(thumbnailUrl)));
  expect(container.querySelector('.media-video-play')).toBeInTheDocument();
  expect(container.querySelector('video')).toBeNull();
  await user.click(count === 1 ? screen.getByRole('button', { name: 'Play video' }) : container.querySelector<HTMLButtonElement>('.post-collage-tile')!);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', getUploadUrl(url)));
  expect(dialog.querySelector('video')).toHaveAttribute('controls');
  expect(dialog.querySelector('video')).toHaveAttribute('autoplay');
});

it('keeps a video placeholder when its poster is missing without mounting an inline player', () => {
  const { container } = renderWithQueryClient(<UploadMedia url="/uploads/legacy.mp4" thumbnail />);
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('.media-video-poster-missing')).toBeInTheDocument();
  expect(container.querySelector('.media-video-play')).toBeInTheDocument();
  expect(container.querySelector('video')).toBeNull();
});

it('uses the thumbnail for a processing single-photo post and the full photo once ready', async () => {
  const photoUrl = url.replace('.mp4', '.jpg');
  const thumbnailUrl = photoUrl.replace('.jpg', '-thumbnail.jpg');
  vi.mocked(fetchUploadProcessing)
    .mockResolvedValueOnce({ status: 'processing', url: photoUrl, thumbnailUrl })
    .mockResolvedValue({ status: 'ready', url: photoUrl, thumbnailUrl });
  const { container } = renderWithQueryClient(<PostCard post={makePost({ uploadedAssetUrls: [photoUrl] })} />);
  await screen.findByText('Media is processing…');
  await waitFor(() => expect(container.querySelector('.post-hero > .media-processing img'))
    .toHaveAttribute('src', getUploadUrl(thumbnailUrl)));
  expect(container.querySelector('.post-hero img[src="' + getUploadUrl(photoUrl) + '"]')).toBeNull();
  await waitFor(() => expect(container.querySelector('.post-hero .shimmer-frame img'))
    .toHaveAttribute('src', getUploadUrl(photoUrl)), { timeout: 4000 });
});

it('shows processing with a preview, then replaces it with the ready video', async () => {
  vi.mocked(fetchUploadProcessing)
    .mockResolvedValueOnce({ status: 'queued', url, thumbnailUrl: url.replace('.mp4', '-thumbnail.jpg') })
    .mockResolvedValue({ status: 'ready', url, thumbnailUrl: url.replace('.mp4', '-thumbnail.jpg') });
  const { container } = renderWithQueryClient(<UploadMedia url={url} />);
  expect(await screen.findByText('Media is processing…')).toBeInTheDocument();
  expect(container.querySelector('video')).toBeNull();
  await waitFor(() => expect(container.querySelector('.media-processing img')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', getUploadUrl(url)), { timeout: 4000 });
  expect(screen.queryByText('Media is processing…')).not.toBeInTheDocument();
});

it('shows a failure instead of an endless processing indicator', async () => {
  vi.mocked(fetchUploadProcessing).mockResolvedValue({ status: 'failed', url, thumbnailUrl: null });
  const { container } = renderWithQueryClient(<UploadMedia url={url} />);
  expect(await screen.findByText('Media processing failed')).toBeInTheDocument();
  expect(container.querySelector('video')).toBeNull();
});
