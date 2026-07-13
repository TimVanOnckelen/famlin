import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewPostModal } from '@/components/NewPostModal';
import { renderWithQueryClient } from '@/test/fixtures';
import { createPost, getGroupMediaAlbums, getMediaAlbumAssets } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  getGroupMediaAlbums: vi.fn(),
  getMediaAlbumAssets: vi.fn(),
  createPost: vi.fn(),
}));

const groups = [{ id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z' }];

const multiGroups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'group-2', name: 'Grandparents', createdAt: '2026-01-01T00:00:00Z' },
];

const mediaAssets = [
  {
    assetId: 'a1',
    type: 'IMAGE',
    width: 100,
    height: 100,
    thumbnailUrl: '/api/media/assets/l1/a1/thumbnail.jpg',
    previewUrl: '/api/media/assets/l1/a1/preview.jpg',
    originalUrl: '/api/media/assets/l1/a1/original.jpg',
  },
  {
    assetId: 'a2',
    type: 'VIDEO',
    width: 100,
    height: 100,
    thumbnailUrl: '/api/media/assets/l1/a2/thumbnail.jpg',
    previewUrl: '/api/media/assets/l1/a2/preview.jpg',
    originalUrl: '/api/media/assets/l1/a2/original.mp4',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPost).mockResolvedValue({} as never);
});

describe('NewPostModal', () => {
  it('hides the album-picker option when the group has no linked albums', async () => {
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await screen.findByRole('button', { name: /Add photos/ });
    expect(screen.queryByRole('button', { name: /Choose from albums/ })).not.toBeInTheDocument();
  });

  it('attaches picked album assets — preview for photos, original for videos', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([
      { linkId: 'l1', provider: 'local', albumName: 'Family album', assetCount: 2 },
    ]);
    vi.mocked(getMediaAlbumAssets).mockResolvedValue(mediaAssets);

    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /Choose from albums/ }));

    // Single linked album → straight to the asset grid.
    const thumbs = await screen.findAllByRole('button', { pressed: false });
    const gridThumbs = thumbs.filter((el) => el.className.includes('media-picker-thumb'));
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
        '/api/media/assets/l1/a1/preview.jpg',
        '/api/media/assets/l1/a2/original.mp4',
      ],
    });
  });

  it('disables Post until there is content or media', async () => {
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const postButton = screen.getByRole('button', { name: 'Post' });
    expect(postButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Share an update/), 'Hello');
    expect(postButton).toBeEnabled();
  });

  it('sends groupIds (cross-posting) when more than one group is selected', async () => {
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQueryClient(
      <NewPostModal groups={multiGroups} defaultGroupId="group-1" onClose={() => {}} />
    );
    await user.type(await screen.findByPlaceholderText(/Share an update/), 'Hello everyone');
    await user.click(screen.getByRole('button', { name: 'Grandparents' }));
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith({
      groupId: 'group-1',
      groupIds: ['group-1', 'group-2'],
      content: 'Hello everyone',
      type: 'UPDATE',
      uploadedAssetUrls: [],
    });
  });

  it('omits groupIds when only one group ends up selected', async () => {
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQueryClient(
      <NewPostModal groups={multiGroups} defaultGroupId="group-1" onClose={() => {}} />
    );
    await user.type(await screen.findByPlaceholderText(/Share an update/), 'Hello everyone');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith({
      groupId: 'group-1',
      groupIds: undefined,
      content: 'Hello everyone',
      type: 'UPDATE',
      uploadedAssetUrls: [],
    });
  });

  it('disables Post once every group has been deselected', async () => {
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQueryClient(
      <NewPostModal groups={multiGroups} defaultGroupId="group-1" onClose={() => {}} />
    );
    await user.type(await screen.findByPlaceholderText(/Share an update/), 'Hello everyone');
    const postButton = screen.getByRole('button', { name: 'Post' });
    expect(postButton).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Familie de Vries' }));
    expect(postButton).toBeDisabled();
  });
});
