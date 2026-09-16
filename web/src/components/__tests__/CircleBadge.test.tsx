import { screen } from '@testing-library/react';
import { PostCard } from '@/components/PostCard';
import { makePost, renderWithQueryClient } from '@/test/fixtures';

// The badge is presentation only — the server never sends a circle post to
// someone who shouldn't see it, so there is no privacy decision here. What
// matters is that a reader can TELL a post went to a circle rather than the
// whole family, which is the feature's whole social contract.
describe('circle badge on a post card', () => {
  it('names the circle a post was shared with', () => {
    renderWithQueryClient(
      <PostCard post={makePost({ circleId: 'circle-1', circle: { id: 'circle-1', name: 'Grandparents' } })} />
    );
    expect(screen.getByText('Grandparents')).toBeInTheDocument();
  });

  it('shows nothing for a whole-family post', () => {
    renderWithQueryClient(<PostCard post={makePost()} />);
    expect(screen.queryByText('Grandparents')).not.toBeInTheDocument();
  });
});
