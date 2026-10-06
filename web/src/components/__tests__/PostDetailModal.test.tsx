import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostDetailModal } from '@/components/PostDetailModal';
import { makePost, makeTrip, renderWithQueryClient } from '@/test/fixtures';
import { fetchComments, fetchPost } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchPost: vi.fn(),
  fetchComments: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchComments).mockResolvedValue([]);
});

describe('PostDetailModal', () => {
  it('shows the post with its full comment thread', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7', commentCount: 0 }));
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={() => {}} />);

    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write a comment…')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />);

    await screen.findByText('Lovely day in the garden.');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a backdrop click', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />);

    await screen.findByText('Lovely day in the garden.');
    await user.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the dialog', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7' }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<PostDetailModal postId="post-7" onClose={onClose} />);

    await user.click(await screen.findByText('Lovely day in the garden.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hands a trip permalink over to the trip page', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'trip-1', type: 'TRIP', trip: makeTrip() }));
    const onOpenTrip = vi.fn();
    renderWithQueryClient(<PostDetailModal postId="trip-1" onClose={() => {}} onOpenTrip={onOpenTrip} />);

    await vi.waitFor(() => expect(onOpenTrip).toHaveBeenCalledWith('trip-1'));
  });
});
