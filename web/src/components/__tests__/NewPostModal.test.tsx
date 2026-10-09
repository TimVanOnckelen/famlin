import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewPostModal } from '@/components/NewPostModal';
import { renderWithQueryClient } from '@/test/fixtures';
import { uploadFilesInSession, addAlbumPhotos, createPost, getGroupMediaAlbums, getMediaAlbumAssets, getUploadUrl } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  getGroupMediaAlbums: vi.fn(),
  getMediaAlbumAssets: vi.fn(),
  uploadFilesInSession: vi.fn(),
  createPost: vi.fn(),
  addAlbumPhotos: vi.fn(),
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
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  }));
  vi.mocked(createPost).mockResolvedValue({} as never);
});

describe('NewPostModal', () => {
  it('merges photo and MOV selected separately in one session and posts only the photo', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg';
    const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4';
    vi.mocked(uploadFilesInSession)
      .mockResolvedValueOnce({ urls: [photoUrl], sessionMedia: [{ url: photoUrl, kind: 'image', status: 'queued', thumbnailUrl: null }] })
      .mockResolvedValueOnce({ urls: [videoUrl], sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: null }] });
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const photo = new File(['photo'], 'IMG_1234.HEIC', { type: 'image/heic' });
    const video = new File(['video'], 'IMG_1234.MOV', { type: 'video/quicktime' });
    await user.upload(input, photo);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    await user.upload(input, video);
    await waitFor(() => expect(screen.getByLabelText('Live Photo')).toBeInTheDocument());
    expect(container.querySelectorAll('.photo-preview')).toHaveLength(1);
    const calls = vi.mocked(uploadFilesInSession).mock.calls;
    expect(calls[0][1]).toBe(calls[1][1]);
    expect(calls[0][0]).toEqual([photo]); expect(calls[1][0]).toEqual([video]);
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ uploadedAssetUrls: [photoUrl] }));
  });

  it('shows the Live Photo upload indicator until a separately selected MOV finishes', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg';
    const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4';
    let finish!: (value: { urls: string[]; sessionMedia: { url: string; videoUrl: string; kind: 'livePhoto'; status: 'queued'; thumbnailUrl: null }[] }) => void;
    vi.mocked(uploadFilesInSession).mockResolvedValueOnce({ urls: [photoUrl], sessionMedia: [] })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(['p'], 'IMG_1234.HEIC', { type: 'image/heic' }));
    await user.upload(input, new File(['v'], 'IMG_1234.MOV', { type: 'video/quicktime' }));
    expect(container.querySelectorAll('.photo-preview')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await act(async () => finish({ urls: [videoUrl], sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: null }] }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
  });

  it('preserves a confirmed pair when concurrent uploads respond out of order', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg';
    const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4';
    let finishPhoto!: (result: { urls: string[]; sessionMedia: { url: string; kind: 'image'; status: 'queued'; thumbnailUrl: null }[] }) => void;
    vi.mocked(uploadFilesInSession).mockImplementation(([file]) => file.name.endsWith('.HEIC')
      ? new Promise((resolve) => { finishPhoto = resolve; })
      : Promise.resolve({ urls: [videoUrl], sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: null }] }));
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [new File(['p'], 'IMG_1234.HEIC', { type: 'image/heic' }), new File(['v'], 'IMG_1234.MOV', { type: 'video/quicktime' })]);
    await act(async () => finishPhoto({ urls: [photoUrl], sessionMedia: [{ url: photoUrl, kind: 'image', status: 'queued', thumbnailUrl: null }] }));
    expect(container.querySelectorAll('.photo-preview')).toHaveLength(1);
    expect(screen.getByLabelText('Live Photo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ uploadedAssetUrls: [photoUrl] }));
  });

  it('removes both components from the session when a Live Photo preview is removed', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg';
    const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4';
    vi.mocked(uploadFilesInSession).mockImplementation(async (files) => !files.length ? { urls: [], sessionMedia: [] } : files[0].name.endsWith('.HEIC')
      ? { urls: [photoUrl], sessionMedia: [] }
      : { urls: [videoUrl], sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: null }] });
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [new File(['p'], 'IMG_1234.HEIC', { type: 'image/heic' }), new File(['v'], 'IMG_1234.MOV', { type: 'video/quicktime' })]);
    await user.click(screen.getByRole('button', { name: /Remove photo/ }));
    expect(container.querySelectorAll('.photo-preview')).toHaveLength(0);
    expect(uploadFilesInSession).toHaveBeenLastCalledWith([], expect.any(String), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
  });

  it('keeps two previews when the session reports that the files are unrelated', async () => {
    const user = userEvent.setup();
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    vi.mocked(uploadFilesInSession).mockImplementation(async ([file]) => ({ urls: [file.name.endsWith('.MOV') ? '/uploads/live.mp4' : '/uploads/live.jpg'], sessionMedia: [] }));
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, [
      new File(['photo'], 'IMG_1234.HEIC', { type: 'image/heic' }),
      new File(['video'], 'IMG_1234.MOV', { type: 'video/quicktime' }),
    ]);
    await waitFor(() => expect(container.querySelectorAll('.photo-preview')).toHaveLength(2));
    expect(screen.queryByLabelText('Live Photo')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Video')).toBeInTheDocument();
  });

  it('uploads on selection, shows a loading indicator and publishes the returned URLs without uploading again', async () => {
    let finish!: (result: { urls: string[] }) => void;
    vi.mocked(uploadFilesInSession).mockImplementation(() => {
      return new Promise((resolve) => { finish = resolve; });
    });
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(uploadFilesInSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    expect(createPost).not.toHaveBeenCalled();
    await act(async () => finish({ urls: ['/uploads/photo.jpg'] }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const preview = screen.getByRole('img', { name: 'photo.jpg' });
    expect(preview).toHaveAttribute('src', getUploadUrl('/uploads/photo.jpg', 'thumbnail'));
    fireEvent.error(preview);
    expect(preview).toHaveAttribute('src', getUploadUrl('/uploads/photo.jpg'));
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ uploadedAssetUrls: ['/uploads/photo.jpg'] }));
    expect(uploadFilesInSession).toHaveBeenCalledTimes(1);
  });

  it('uploads each selected photo separately and keeps successful uploads when another fails', async () => {
    const finish: ((result: { urls: string[] }) => void)[] = [];
    const fail: ((error: Error) => void)[] = [];
    vi.mocked(uploadFilesInSession).mockImplementation(() => new Promise((resolve, reject) => {
      finish.push(resolve);
      fail.push(reject);
    }));
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const photos = ['a.jpg', 'b.jpg'].map((name) => new File(['photo'], name, { type: 'image/jpeg' }));
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, photos);
    expect(uploadFilesInSession).toHaveBeenCalledTimes(2);
    expect(uploadFilesInSession).toHaveBeenNthCalledWith(1, [photos[0]], expect.any(String), []);
    expect(uploadFilesInSession).toHaveBeenNthCalledWith(2, [photos[1]], expect.any(String), []);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    await act(async () => finish[0]({ urls: ['/uploads/a.jpg'] }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await act(async () => fail[1](new Error('Offline')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ uploadedAssetUrls: ['/uploads/a.jpg'] }));
  });

  it('keeps a removed pending photo out of the post after the upload finishes', async () => {
    let finish!: (result: { urls: string[] }) => void;
    vi.mocked(uploadFilesInSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Remove photo/ }));
    await act(async () => finish({ urls: ['/uploads/photo.jpg'] }));
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ uploadedAssetUrls: [] }));
  });

  it('shows an upload error and allows selecting the photo again', async () => {
    vi.mocked(uploadFilesInSession).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ urls: ['/uploads/photo.jpg'] });
    vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(input, photo);
    expect(await screen.findByRole('alert')).toHaveTextContent('Photo upload failed');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add photos' }));
    await user.upload(input, photo);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

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

      await user.click(screen.getByRole('button', { name: 'Poll' }));
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

      await user.click(screen.getByRole('button', { name: 'Poll' }));
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

      await user.click(screen.getByRole('button', { name: 'Poll' }));
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

      await user.click(screen.getByRole('button', { name: 'Poll' }));
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

  describe('album composer', () => {
    it('disables Post until an album title is entered, then submits type ALBUM with the title', async () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      vi.mocked(createPost).mockResolvedValue({ id: 'album-post' } as never);
      const user = userEvent.setup();
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: 'Album' }));
      const postButton = screen.getByRole('button', { name: 'Post' });
      expect(postButton).toBeDisabled();

      await user.type(await screen.findByPlaceholderText(/Album title/), 'Summer at the lake');
      expect(postButton).toBeEnabled();
      await user.click(postButton);

      expect(createPost).toHaveBeenCalledWith({
        groupId: 'group-1',
        groupIds: undefined,
        content: undefined,
        type: 'ALBUM',
        typeData: { title: 'Summer at the lake' },
        uploadedAssetUrls: [],
      });
      // No photos picked → no seed contribution.
      expect(addAlbumPhotos).not.toHaveBeenCalled();
    });
  });

  describe('per-group allowed post types', () => {
    it('shows all type chips for groups without allowedPostTypes (older servers)', () => {
      vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
      renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Milestone' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Poll' })).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Poll' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
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
      await user.click(screen.getByRole('button', { name: 'Poll' }));
      expect(screen.getByPlaceholderText('Ask a question…')).toBeInTheDocument();

      // Add group-2: the intersection is just UPDATE, so the Poll (and
      // Milestone) chips disappear and the selected type resets to Update.
      await user.click(screen.getByRole('button', { name: 'Grandparents' }));
      expect(screen.queryByRole('button', { name: 'Poll' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Milestone' })).not.toBeInTheDocument();
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
