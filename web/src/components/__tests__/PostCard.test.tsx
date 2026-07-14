import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useInfiniteQuery } from '@tanstack/react-query';
import { PostCard } from '@/components/PostCard';
import { makePost, makePoll, renderWithQueryClient } from '@/test/fixtures';
import { Post, reactToPost, toggleFavoritePost, votePoll } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  reactToPost: vi.fn().mockResolvedValue({ myReaction: 'LIKE', counts: { LIKE: 1 } }),
  toggleFavoritePost: vi.fn().mockResolvedValue({ favorited: true }),
  votePoll: vi.fn(),
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

  it('labels the post with its family when showGroup is set', () => {
    renderWithQueryClient(<PostCard post={makePost()} showGroup />);
    expect(screen.getByText('Familie de Vries')).toBeInTheDocument();
  });

  it('omits the family label by default', () => {
    renderWithQueryClient(<PostCard post={makePost()} />);
    expect(screen.queryByText('Familie de Vries')).not.toBeInTheDocument();
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

  it('sends a LOVE (matching the heart icon) when the reaction button is clicked without a prior reaction', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<PostCard post={makePost({ likeCount: 0 })} />);
    await user.click(screen.getByRole('button', { name: /^0$/ }));
    expect(reactToPost).toHaveBeenCalledWith('post-1', 'LOVE');
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

  it('renders person chips when post has people', () => {
    renderWithQueryClient(
      <PostCard
        post={makePost({
          people: [
            {
              id: 'person-1',
              provider: 'immich',
              label: 'Emma',
              userId: 'user-2',
              userName: 'Emma Smith',
              userAvatarUrl: null,
            },
            {
              id: 'person-2',
              provider: 'immich',
              label: 'Sophie',
              userId: null,
              userName: null,
              userAvatarUrl: null,
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Emma')).toBeInTheDocument();
    expect(screen.getByText('Sophie')).toBeInTheDocument();
  });

  it('does not render people section when post has no people', () => {
    const { container } = renderWithQueryClient(<PostCard post={makePost({ people: [] })} />);
    expect(container.querySelector('.post-people')).not.toBeInTheDocument();
  });

  it('shows the shared-with indicator when the post was cross-posted', () => {
    renderWithQueryClient(
      <PostCard
        post={makePost({
          sharedWithGroups: [
            { id: 'group-1', name: 'Familie de Vries' },
            { id: 'group-2', name: 'Grandparents' },
          ],
        })}
      />
    );
    expect(screen.getByText('Shared with Familie de Vries, Grandparents')).toBeInTheDocument();
  });

  it('does not show the shared-with indicator when sharedWithGroups is absent', () => {
    const { container } = renderWithQueryClient(<PostCard post={makePost()} />);
    expect(container.querySelector('.post-shared-indicator')).not.toBeInTheDocument();
  });

  // Mirrors how FeedPage actually feeds PostCard: a live ['posts', ...]
  // infinite query, so patchPostInCaches's cache write (from the poll vote
  // mutation) flows back down as a real re-render instead of being invisible
  // to a PostCard fed a static prop.
  function PollFeedHarness({ initialPost }: { initialPost: Post }) {
    const { data } = useInfiniteQuery({
      queryKey: ['posts', 'test'],
      queryFn: () => Promise.resolve({ items: [initialPost], nextCursor: null }),
      initialData: { pages: [{ items: [initialPost], nextCursor: null }], pageParams: [null] },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
    const post = data!.pages[0].items[0];
    return <PostCard post={post} />;
  }

  describe('poll posts', () => {
    it('renders the question, options, vote counts, and percentages', () => {
      renderWithQueryClient(
        <PostCard post={makePost({ type: 'POLL', content: 'Pizza or sushi?', poll: makePoll() })} />
      );
      expect(screen.getByText('Pizza or sushi?')).toBeInTheDocument();
      expect(screen.getByText('Pizza')).toBeInTheDocument();
      expect(screen.getByText('Sushi')).toBeInTheDocument();
      expect(screen.getByText('67%')).toBeInTheDocument();
      expect(screen.getByText('33%')).toBeInTheDocument();
      expect(screen.getByText('2 votes')).toBeInTheDocument();
      expect(screen.getByText('1 vote')).toBeInTheDocument();
      expect(screen.getByText('3 votes total')).toBeInTheDocument();
    });

    it('votes for an option and re-renders from the returned post', async () => {
      const updatedPost = makePost({
        type: 'POLL',
        content: 'Pizza or sushi?',
        poll: makePoll({
          myVoteOptionId: 'opt-1',
          options: [
            { id: 'opt-1', text: 'Pizza', voteCount: 3, voters: [] },
            { id: 'opt-2', text: 'Sushi', voteCount: 1, voters: [] },
          ],
          totalVotes: 4,
        }),
      });
      vi.mocked(votePoll).mockResolvedValue(updatedPost);

      const user = userEvent.setup();
      renderWithQueryClient(
        <PollFeedHarness initialPost={makePost({ type: 'POLL', content: 'Pizza or sushi?', poll: makePoll() })} />
      );
      await user.click(screen.getByText('Pizza'));
      expect(votePoll).toHaveBeenCalledWith('post-1', 'opt-1');
      expect(await screen.findByText('4 votes total')).toBeInTheDocument();
    });

    it('disables options and shows a closed label when the poll is closed', () => {
      renderWithQueryClient(
        <PostCard
          post={makePost({
            type: 'POLL',
            content: 'Pizza or sushi?',
            poll: makePoll({ closed: true, closesAt: '2026-01-01T00:00:00Z' }),
          })}
        />
      );
      expect(screen.getByText('Poll closed')).toBeInTheDocument();
      expect(screen.getByText('Pizza').closest('button')).toBeDisabled();
      expect(screen.getByText('Sushi').closest('button')).toBeDisabled();
    });
  });

  it('falls back to plain text content for an unknown custom post type', () => {
    renderWithQueryClient(
      <PostCard post={makePost({ type: 'RSVP', content: 'Are you coming to the picnic?' })} />
    );
    expect(screen.getByText('Are you coming to the picnic?')).toBeInTheDocument();
  });
});
