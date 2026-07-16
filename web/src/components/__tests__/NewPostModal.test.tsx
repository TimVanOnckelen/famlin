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

const groups = [{ id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false }];

const multiGroups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
  { id: 'group-2', name: 'Grandparents', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
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

  describe('poll composer', () => {
    it('disables Post with a question but fewer than 2 non-empty options', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: '📊 Poll' }));
      await user.type(await screen.findByPlaceholderText('Ask a question…'), 'Pizza or sushi?');
      const postButton = screen.getByRole('button', { name: 'Post' });
      expect(postButton).toBeDisabled();

      await user.type(screen.getByPlaceholderText('Option 1'), 'Pizza');
      expect(postButton).toBeDisabled();
    });

    it('enables Post once the question and 2 options are filled in, and submits the right payload', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: '📊 Poll' }));
      await user.type(await screen.findByPlaceholderText('Ask a question…'), 'Pizza or sushi?');
      await user.type(screen.getByPlaceholderText('Option 1'), 'Pizza');
      await user.type(screen.getByPlaceholderText('Option 2'), 'Sushi');

      const postButton = screen.getByRole('button', { name: 'Post' });
      expect(postButton).toBeEnabled();
      await user.click(postButton);

      expect(createPost).toHaveBeenCalledWith({
        groupId: 'group-1',
        groupIds: undefined,
        content: 'Pizza or sushi?',
        type: 'POLL',
        typeData: { options: [{ text: 'Pizza' }, { text: 'Sushi' }] },
        uploadedAssetUrls: [],
      });
    });

    it('adds and removes option rows, capped at 10 and floored at 2', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: '📊 Poll' }));
      expect(screen.queryByLabelText('Remove option')).not.toBeInTheDocument();

      const addButton = screen.getByRole('button', { name: 'Add option' });
      for (let i = 0; i < 8; i++) {
        await user.click(addButton);
      }
      expect(screen.getAllByLabelText('Remove option')).toHaveLength(10);
      expect(screen.queryByRole('button', { name: 'Add option' })).not.toBeInTheDocument();

      await user.click(screen.getAllByLabelText('Remove option')[0]);
      expect(screen.getAllByLabelText('Remove option')).toHaveLength(9);
    });

    it('filters out blank option rows before submitting', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: '📊 Poll' }));
      await user.type(await screen.findByPlaceholderText('Ask a question…'), 'Pizza or sushi?');
      await user.click(screen.getByRole('button', { name: 'Add option' }));
      await user.type(screen.getByPlaceholderText('Option 1'), 'Pizza');
      await user.type(screen.getByPlaceholderText('Option 2'), 'Sushi');
      // Option 3 left blank.

      await user.click(screen.getByRole('button', { name: 'Post' }));
      expect(createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          typeData: { options: [{ text: 'Pizza' }, { text: 'Sushi' }] },
        })
      );
    });
  });

  describe('per-group allowed post types', () => {
    it('shows all type chips for groups without allowedPostTypes (older servers)', () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '🎂 Milestone' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '📊 Poll' })).toBeInTheDocument();
    });

    it('hides type chips the group does not allow', () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const restrictedGroups = [
        {
          id: 'group-1',
          name: 'Familie de Vries',
          createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false,
          allowedPostTypes: ['UPDATE', 'POLL'],
        },
      ];
      renderWithQueryClient(
        <NewPostModal groups={restrictedGroups} defaultGroupId="group-1" onClose={() => {}} />
      );
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '📊 Poll' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '🎂 Milestone' })).not.toBeInTheDocument();
    });

    it('offers only the intersection when cross-posting and resets a type that falls out', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      const mixedGroups = [
        {
          id: 'group-1',
          name: 'Familie de Vries',
          createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false,
          allowedPostTypes: ['UPDATE', 'POLL'],
        },
        {
          id: 'group-2',
          name: 'Grandparents',
          createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false,
          allowedPostTypes: ['UPDATE', 'MILESTONE'],
        },
      ];
      renderWithQueryClient(
        <NewPostModal groups={mixedGroups} defaultGroupId="group-1" onClose={() => {}} />
      );

      // Only group-1 selected: Poll is offered — pick it.
      await user.click(screen.getByRole('button', { name: '📊 Poll' }));
      expect(screen.getByPlaceholderText('Ask a question…')).toBeInTheDocument();

      // Add group-2: the intersection is just UPDATE, so the Poll (and
      // Milestone) chips disappear and the selected type resets to Update.
      await user.click(screen.getByRole('button', { name: 'Grandparents' }));
      expect(screen.queryByRole('button', { name: '📊 Poll' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '🎂 Milestone' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
      expect(await screen.findByPlaceholderText(/Share an update/)).toBeInTheDocument();

      // The reset really applies to the submitted payload too.
      await user.type(screen.getByPlaceholderText(/Share an update/), 'Hello');
      await user.click(screen.getByRole('button', { name: 'Post' }));
      expect(createPost).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UPDATE', typeData: undefined })
      );
    });

    it('disables submit and shows a notice when the selected groups share no post type', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      const user = userEvent.setup();
      const disjointGroups = [
        {
          id: 'group-1',
          name: 'Familie de Vries',
          createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false,
          allowedPostTypes: ['POLL'],
        },
        {
          id: 'group-2',
          name: 'Grandparents',
          createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false,
          allowedPostTypes: ['MILESTONE'],
        },
      ];
      renderWithQueryClient(
        <NewPostModal groups={disjointGroups} defaultGroupId="group-1" onClose={() => {}} />
      );

      await user.click(screen.getByRole('button', { name: 'Grandparents' }));
      expect(
        screen.getByText(/don't have any post type in common/)
      ).toBeInTheDocument();
      await user.type(screen.getByRole('textbox'), 'Hello');
      expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    });
  });
});
