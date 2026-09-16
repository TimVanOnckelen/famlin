import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostCard } from '@/components/PostCard';
import { makePost, renderWithQueryClient } from '@/test/fixtures';
import { fetchCircleMembers } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchCircleMembers: vi.fn(),
}));

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

describe('circle member list', () => {
  // The transparency half of the privacy model: an admin isn't an implicit
  // member of a circle, but they CAN add themselves to one — so what members
  // actually get is "nobody reads this silently", which only means anything
  // if the membership is somewhere they can look.
  it('opens the member list from the badge, showing when each person joined', async () => {
    vi.mocked(fetchCircleMembers).mockResolvedValue([
      { id: 'u1', name: 'Oma', joinedAt: '2026-01-02T00:00:00Z' },
      { id: 'u2', name: 'Opa', joinedAt: '2026-03-04T00:00:00Z' },
    ]);

    renderWithQueryClient(
      <PostCard post={makePost({ circleId: 'circle-1', circle: { id: 'circle-1', name: 'Grandparents' } })} />
    );

    await userEvent.click(screen.getByRole('button', { name: /who can see/i }));

    expect(await screen.findByText('Oma')).toBeInTheDocument();
    expect(screen.getByText('Opa')).toBeInTheDocument();
    expect(fetchCircleMembers).toHaveBeenCalledWith('circle-1');
  });
});
