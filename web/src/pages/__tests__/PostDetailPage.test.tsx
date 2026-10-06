import { screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { PostDetailPage } from '@/pages/PostDetailPage';
import { makeComment, makePost, makeTrip, renderWithQueryClient } from '@/test/fixtures';
import { fetchComments, fetchPost } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchPost: vi.fn(),
  fetchComments: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}));

function httpError(status: number) {
  return new AxiosError('fail', undefined, undefined, undefined, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PostDetailPage', () => {
  it('shows the post with its comment thread already open', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'post-7', commentCount: 1 }));
    vi.mocked(fetchComments).mockResolvedValue([makeComment({ postId: 'post-7', content: 'Gorgeous!' })]);

    renderWithQueryClient(<PostDetailPage postId="post-7" onBack={() => {}} />);

    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(await screen.findByText('Gorgeous!')).toBeInTheDocument();
    expect(fetchPost).toHaveBeenCalledWith('post-7');
  });

  it.each([404, 403])('says the post is not available on a %s', async (status) => {
    vi.mocked(fetchPost).mockRejectedValue(httpError(status));
    const onOpenFeed = vi.fn();

    renderWithQueryClient(<PostDetailPage postId="gone" onBack={() => {}} onOpenFeed={onOpenFeed} />);

    expect(await screen.findByText("This post doesn't exist, or it isn't shared with you.")).toBeInTheDocument();
    screen.getByRole('button', { name: 'Back to the feed' }).click();
    expect(onOpenFeed).toHaveBeenCalled();
  });

  it('offers a retry when the post fails to load for another reason', async () => {
    vi.mocked(fetchPost).mockRejectedValue(httpError(500));
    renderWithQueryClient(<PostDetailPage postId="post-1" onBack={() => {}} />);
    expect(await screen.findByText(/This post couldn't be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('hands a trip permalink over to the trip page', async () => {
    vi.mocked(fetchPost).mockResolvedValue(makePost({ id: 'trip-1', type: 'TRIP', trip: makeTrip() }));
    const onOpenTrip = vi.fn();

    renderWithQueryClient(<PostDetailPage postId="trip-1" onBack={() => {}} onOpenTrip={onOpenTrip} />);

    await vi.waitFor(() => expect(onOpenTrip).toHaveBeenCalledWith('trip-1'));
  });
});
