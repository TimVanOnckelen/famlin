import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPost, fetchMyCircles, getGroupMediaAlbums, uploadFilesInSession } from '@famlin/api-client';
import { NewPostModal } from '../NewPostModal';
import { makeUser, renderWithQueryClient } from '@/test/fixtures';
import { useAuthStore } from '@/stores/authStore';
import { postDraftStorageKey } from '@/stores/postDraft';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  getGroupMediaAlbums: vi.fn(), fetchMyCircles: vi.fn(), uploadFilesInSession: vi.fn(), createPost: vi.fn(), addAlbumPhotos: vi.fn(),
}));
const groups = [{ id: 'group-1', name: 'Family', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false }, { id: 'group-2', name: 'Other family', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false }];
const photoUrl = '/uploads/11111111-1111-4111-8111-111111111111.jpg';
const videoUrl = '/uploads/22222222-2222-4222-8222-222222222222.mp4';
let userId: string;
let key: string;
let count = 0;
const open = () => renderWithQueryClient(<NewPostModal groups={groups} defaultGroupId="group-1" onClose={vi.fn()} />);
const saved = () => JSON.parse(localStorage.getItem(key)!);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  userId = `draft-user-${++count}`; key = postDraftStorageKey(userId)!;
  useAuthStore.setState({ user: makeUser({ id: userId }) });
  vi.mocked(getGroupMediaAlbums).mockResolvedValue([]);
  vi.mocked(fetchMyCircles).mockResolvedValue([]);
  vi.mocked(createPost).mockResolvedValue({ id: 'created-post' } as never);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { act(() => useAuthStore.setState({ user: null })); vi.restoreAllMocks(); });

it('restores text, poll settings and selected groups after closing the editor', async () => {
  const user = userEvent.setup(); const first = open();
  await user.click(screen.getByRole('button', { name: 'Poll' }));
  await user.type(screen.getByPlaceholderText('Ask a question…'), 'Where next?');
  await user.type(screen.getByPlaceholderText('Option 1'), 'Park');
  await user.type(screen.getByPlaceholderText('Option 2'), 'Beach');
  await user.click(screen.getByRole('button', { name: 'Other family' }));
  const session = saved().uploadSessionId;
  first.unmount(); open();
  expect(screen.getByPlaceholderText('Ask a question…')).toHaveValue('Where next?');
  expect(screen.getByPlaceholderText('Option 1')).toHaveValue('Park');
  expect(screen.getByPlaceholderText('Option 2')).toHaveValue('Beach');
  expect(screen.getByRole('button', { name: 'Other family' })).toHaveAttribute('aria-pressed', 'true');
  expect(saved().uploadSessionId).toBe(session);
});

it('restores serialized Live Photo URLs without uploading again or persisting file bytes', async () => {
  const user = userEvent.setup();
  localStorage.setItem(key, JSON.stringify({ version: 1, uploadSessionId: crypto.randomUUID(), selectedGroupIds: ['group-1'], type: 'UPDATE', content: 'A live memory', pollOptions: ['', ''], albumTitle: '',
    files: [{ id: 0, name: 'IMG_1234.HEIC', type: 'image/heic', url: photoUrl }, { id: 1, name: 'IMG_1234.MOV', type: 'video/quicktime', url: videoUrl }],
    sessionMedia: [{ url: photoUrl, videoUrl, kind: 'livePhoto', status: 'queued', thumbnailUrl: photoUrl.replace('.jpg', '-thumbnail.jpg') }], mediaAssets: [], excludedKeys: [] }));
  const { container } = open();
  expect(screen.getByRole('textbox')).toHaveValue('A live memory');
  expect(container.querySelectorAll('.photo-preview')).toHaveLength(1);
  expect(screen.getByLabelText('Live Photo')).toBeInTheDocument();
  expect(uploadFilesInSession).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Post' }));
  expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ content: 'A live memory', uploadedAssetUrls: [photoUrl] }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});

it('finishes an upload into the draft after the modal closes and restores its preview', async () => {
  const user = userEvent.setup(); let finish!: (value: { urls: string[] }) => void;
  vi.mocked(uploadFilesInSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = open();
  await user.type(screen.getByRole('textbox'), 'Photo draft');
  await user.upload(first.container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['secret image bytes'], 'photo.jpg', { type: 'image/jpeg' }));
  first.unmount();
  await act(async () => finish({ urls: [photoUrl] }));
  expect(saved().files[0]).toMatchObject({ name: 'photo.jpg', url: photoUrl });
  expect(localStorage.getItem(key)).not.toContain('blob:'); expect(localStorage.getItem(key)).not.toContain('secret image bytes');
  const second = open();
  expect(second.container.querySelectorAll('.photo-preview')).toHaveLength(1);
  expect(screen.getByRole('textbox')).toHaveValue('Photo draft');
  expect(uploadFilesInSession).toHaveBeenCalledTimes(1);
});

it('keeps a draft on publication failure and clears it only on success', async () => {
  const user = userEvent.setup(); vi.mocked(createPost).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({} as never);
  open(); await user.type(screen.getByRole('textbox'), 'Keep my text');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await screen.findByText(/couldn.t be created/);
  expect(saved().content).toBe('Keep my text');
  await user.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});

it('isolates drafts between accounts', async () => {
  const user = userEvent.setup(); const first = open();
  await user.type(screen.getByRole('textbox'), 'Private draft'); first.unmount();
  useAuthStore.setState({ user: makeUser({ id: `${userId}-other` }) });
  const other = open(); expect(screen.getByRole('textbox')).toHaveValue(''); other.unmount();
  useAuthStore.setState({ user: makeUser({ id: userId }) }); open();
  expect(screen.getByRole('textbox')).toHaveValue('Private draft');
});

it('restores album title, description and valid circle settings', async () => {
  const user = userEvent.setup();
  vi.mocked(fetchMyCircles).mockResolvedValue([{ id: 'circle-1', name: 'Close family' } as never]);
  const first = open();
  await user.click(await screen.findByRole('radio', { name: /Close family/ }));
  await user.click(screen.getByRole('button', { name: 'Album' }));
  await user.type(screen.getByPlaceholderText(/Album title/), 'Summer photos');
  await user.type(first.container.querySelector('textarea')!, 'The whole trip');
  first.unmount(); open();
  expect(screen.getByPlaceholderText(/Album title/)).toHaveValue('Summer photos');
  expect(await screen.findByRole('radio', { name: /Close family/ })).toHaveAttribute('aria-checked', 'true');
  expect(saved().albumTitle).toBe('Summer photos'); expect(saved().selectedCircleId).toBe('circle-1');
});

it('requires an explicit audience choice if the saved group is no longer available', async () => {
  const user = userEvent.setup();
  localStorage.setItem(key, JSON.stringify({ version: 1, uploadSessionId: crypto.randomUUID(), selectedGroupIds: ['gone-group'], selectedCircleId: 'private-circle', type: 'UPDATE', content: 'Private memory', files: [], mediaAssets: [], sessionMedia: [] }));
  open();
  expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('saved audience');
  await user.click(screen.getByRole('button', { name: 'Family' }));
  expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
  expect(saved().selectedGroupIds).toEqual(['group-1']); expect(saved().selectedCircleId).toBeNull();
});

it('ignores malformed localStorage without breaking the composer', () => {
  localStorage.setItem(key, '{invalid'); open(); expect(screen.getByRole('textbox')).toHaveValue('');
});
