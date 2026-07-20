import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentsSection } from '@/components/CommentsSection';
import { makeComment, makePost, renderWithQueryClient } from '@/test/fixtures';
import { api, createComment, fetchComments } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  reactToComment: vi.fn().mockResolvedValue({ myReaction: 'LIKE', counts: { LIKE: 1 } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommentsSection', () => {
  it('lists comments with replies indented under their parent', async () => {
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({ id: 'c1', content: 'First!' }),
      makeComment({ id: 'c2', content: 'A reply', parentId: 'c1', author: { id: 'u3', name: 'Rita', avatarUrl: null } }),
    ]);
    renderWithQueryClient(<CommentsSection post={makePost()} />);

    expect(await screen.findByText('First!')).toBeInTheDocument();
    expect(screen.getByText('A reply').closest('.comment')).toHaveClass('comment-reply');
  });

  it('shows an empty hint when there are no comments', async () => {
    vi.mocked(fetchComments).mockResolvedValue([]);
    renderWithQueryClient(<CommentsSection post={makePost()} />);
    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument();
  });

  it('submits a new comment and appends it', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue(makeComment({ id: 'new', content: 'Hello family' }));

    renderWithQueryClient(<CommentsSection post={makePost()} />);
    await user.type(await screen.findByPlaceholderText('Write a comment…'), 'Hello family');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(createComment).toHaveBeenCalledWith('post-1', { content: 'Hello family' });
    expect(await screen.findByText('Hello family')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Write a comment…')).toHaveValue('')
    );
  });

  it('disables send for an empty draft', async () => {
    vi.mocked(fetchComments).mockResolvedValue([]);
    renderWithQueryClient(<CommentsSection post={makePost()} />);
    expect(await screen.findByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('renders a photo attachment on a comment', async () => {
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({ id: 'c1', content: '', attachmentUrl: '/uploads/photo.jpg' }),
    ]);
    renderWithQueryClient(<CommentsSection post={makePost()} />);

    expect(await screen.findByRole('button', { name: 'View attachment' })).toBeInTheDocument();
  });

  it('uploads a picked photo and sends the comment with its attachmentUrl', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
    URL.revokeObjectURL = vi.fn();
    const uploadSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { urls: ['/uploads/new-photo.jpg'] } });
    const user = userEvent.setup();
    vi.mocked(fetchComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue(makeComment({ id: 'new', attachmentUrl: '/uploads/new-photo.jpg' }));

    const { container } = renderWithQueryClient(<CommentsSection post={makePost()} />);
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByRole('button', { name: 'Remove attachment' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(uploadSpy).toHaveBeenCalled());
    expect(createComment).toHaveBeenCalledWith('post-1', {
      content: undefined,
      attachmentUrl: '/uploads/new-photo.jpg',
    });
  });

  // filterComments backs TripDetailPage's "Reacties op de reis" section,
  // which must never surface check-in comments (metadata.kind ===
  // 'trip_checkin') or their replies — see web's TripDetailPage.tsx.
  it('excludes comments (and their replies) that filterComments removes', async () => {
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({ id: 'checkin-1', content: 'Arrived in Bologna!', metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [], checkinId: 'checkin-1' } }),
      makeComment({ id: 'checkin-reply', content: 'Nice!', parentId: 'checkin-1' }),
      makeComment({ id: 'trip-comment', content: 'Have a great trip!' }),
    ]);
    renderWithQueryClient(
      <CommentsSection post={makePost()} filterComments={(all) => all.filter((c) => c.metadata?.kind !== 'trip_checkin')} />
    );

    expect(await screen.findByText('Have a great trip!')).toBeInTheDocument();
    expect(screen.queryByText('Arrived in Bologna!')).not.toBeInTheDocument();
    expect(screen.queryByText('Nice!')).not.toBeInTheDocument();
  });
});
