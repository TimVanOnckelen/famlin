import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostCard } from '@/components/PostCard';
import { makePost, renderWithQueryClient } from '@/test/fixtures';
import { reactToPost, toggleFavoritePost } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  reactToPost: vi.fn().mockResolvedValue({ myReaction: 'LIKE', counts: { LIKE: 1 } }),
  toggleFavoritePost: vi.fn().mockResolvedValue({ favorited: true }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PostCard', () => {
  it('renders a standard post with author, content, and counts', () => {
    renderWithQueryClient(<PostCard post={makePost({ likeCount: 3, commentCount: 2 })} />);
    expect(screen.getByText('Grandpa John')).toBeInTheDocument();
    expect(screen.getByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^3$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 comments/ })).toBeInTheDocument();
    expect(screen.queryByText(/MILESTONE/)).not.toBeInTheDocument();
  });

  it('renders the milestone badge and title for milestone posts', () => {
    renderWithQueryClient(<PostCard post={makePost({ type: 'MILESTONE', content: 'Emma turns 5! 🎉' })} />);
    expect(screen.getByText(/MILESTONE/)).toBeInTheDocument();
    expect(screen.getByText('Emma turns 5! 🎉')).toBeInTheDocument();
  });

  it('shows the photo hero with the floating author chip for photo posts', () => {
    const { container } = renderWithQueryClient(
      <PostCard post={makePost({ uploadedAssetUrls: ['/uploads/a.jpg'] })} />
    );
    expect(container.querySelector('.post-hero img')).toBeInTheDocument();
    expect(container.querySelector('.post-hero-chip')).toHaveTextContent('Grandpa John');
  });

  it('sends a LIKE when the reaction button is clicked without a prior reaction', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<PostCard post={makePost({ likeCount: 0 })} />);
    await user.click(screen.getByRole('button', { name: /^0$/ }));
    expect(reactToPost).toHaveBeenCalledWith('post-1', 'LIKE');
  });

  it('sends the chosen emoji reaction from the picker', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<PostCard post={makePost()} />);
    await user.click(screen.getByRole('menu').querySelector('[aria-label="LOVE"]') as HTMLElement);
    expect(reactToPost).toHaveBeenCalledWith('post-1', 'LOVE');
  });

  it('toggles the favorite bookmark', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<PostCard post={makePost()} />);
    await user.click(screen.getByRole('button', { name: 'Save as favorite' }));
    expect(toggleFavoritePost).toHaveBeenCalledWith('post-1');
  });
});
