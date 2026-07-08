import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentsSection } from '@/components/CommentsSection';
import { makeComment, makePost, renderWithQueryClient } from '@/test/fixtures';
import { createComment, fetchComments } from '@famlin/api-client';

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
});
