import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewPostModal } from '@/components/NewPostModal';
import { renderWithQueryClient } from '@/test/fixtures';
import { createPost, getGroupImmichAlbums, getImmichAlbumAssets } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  getGroupImmichAlbums: vi.fn(),
  getImmichAlbumAssets: vi.fn(),
  createPost: vi.fn(),
}));

const groups = [{ id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z' }];

const immichAssets = [
  {
    assetId: 'a1',
    type: 'IMAGE',
    width: 100,
    height: 100,
    thumbnailUrl: '/api/immich/assets/l1/a1/thumbnail.jpg',
    previewUrl: '/api/immich/assets/l1/a1/preview.jpg',
    originalUrl: '/api/immich/assets/l1/a1/original.jpg',
  },
  {
    assetId: 'a2',
    type: 'VIDEO',
    width: 100,
    height: 100,
    thumbnailUrl: '/api/immich/assets/l1/a2/thumbnail.jpg',
    previewUrl: '/api/immich/assets/l1/a2/preview.jpg',
    originalUrl: '/api/immich/assets/l1/a2/original.mp4',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPost).mockResolvedValue({} as never);
});

describe('NewPostModal', () => {
  it('hides the Immich option when the group has no linked albums', async () => {
    vi.mocked(getGroupImmichAlbums).mockResolvedValue([]);
    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await screen.findByRole('button', { name: /Add photos/ });
    expect(screen.queryByRole('button', { name: /Choose from Immich/ })).not.toBeInTheDocument();
  });

  it('attaches picked Immich assets — preview for photos, original for videos', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupImmichAlbums).mockResolvedValue([
      { linkId: 'l1', albumName: 'Family album', assetCount: 2 },
    ]);
    vi.mocked(getImmichAlbumAssets).mockResolvedValue(immichAssets);

    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Choose from Immich/ }));

    // Single linked album → straight to the asset grid.
    const thumbs = await screen.findAllByRole('button', { pressed: false });
    const gridThumbs = thumbs.filter((el) => el.className.includes('immich-thumb'));
    expect(gridThumbs).toHaveLength(2);
    await user.click(gridThumbs[0]);
    await user.click(gridThumbs[1]);
    await user.click(screen.getByRole('button', { name: 'Add 2 photos' }));

    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith({
      groupId: 'group-1',
      content: undefined,
      type: 'UPDATE',
      uploadedAssetUrls: [
        '/api/immich/assets/l1/a1/preview.jpg',
        '/api/immich/assets/l1/a2/original.mp4',
      ],
    });
  });

  it('disables Post until there is content or media', async () => {
    vi.mocked(getGroupImmichAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const postButton = screen.getByRole('button', { name: 'Post' });
    expect(postButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Share an update/), 'Hello');
    expect(postButton).toBeEnabled();
  });
});
