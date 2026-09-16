import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedPage } from '@/pages/FeedPage';
import { makePost, makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchGroups, fetchMyCircles, fetchPosts } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchMyCircles: vi.fn(),
  fetchPosts: vi.fn(),
}));

const groups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
  { id: 'group-2', name: 'Neefjes', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGroups).mockResolvedValue(groups);
  // No circles by default — the circle filter row only appears for a viewer
  // who is actually in one.
  vi.mocked(fetchMyCircles).mockResolvedValue([]);
  vi.mocked(fetchPosts).mockResolvedValue({ items: [makePost()], nextCursor: null });
});

describe('FeedPage', () => {
  it('shows every family by default (no group filter sent)', async () => {
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(fetchPosts).toHaveBeenCalledWith({ groupIds: [], circleIds: [], cursor: undefined });
  });

  it('filters to one family and back to all', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Neefjes' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-2'], circleIds: [], cursor: undefined })
    );

    await user.click(screen.getByRole('button', { name: 'All families' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenLastCalledWith({ groupIds: [], circleIds: [], cursor: undefined })
    );
  });

  it('offers circle chips and narrows the feed to just that circle', async () => {
    // Only circles the viewer is in ever come back from the server — a group
    // member outside a circle receives an empty list, so there is nothing for
    // this component to hide.
    vi.mocked(fetchMyCircles).mockResolvedValue([
      {
        id: 'circle-1',
        groupId: 'group-1',
        name: 'Grandparents',
        memberCount: 3,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);

    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);

    const chip = await screen.findByRole('button', { name: 'Grandparents' });
    await userEvent.click(chip);

    await waitFor(() =>
      expect(fetchPosts).toHaveBeenLastCalledWith({
        groupIds: [],
        circleIds: ['circle-1'],
        cursor: undefined,
      })
    );
  });

  it('hides the circle filter row when the viewer is in no circles', async () => {
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    await screen.findByRole('button', { name: 'Familie de Vries' });
    expect(screen.queryByRole('group', { name: /circle/i })).not.toBeInTheDocument();
  });

  it('selects multiple families at once', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Familie de Vries' }));
    await user.click(screen.getByRole('button', { name: 'Neefjes' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-1', 'group-2'], circleIds: [], cursor: undefined })
    );
  });

  it('hides the filter for single-family users', async () => {
    vi.mocked(fetchGroups).mockResolvedValue([groups[0]]);
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    await screen.findByText('Lovely day in the garden.');
    expect(screen.queryByRole('button', { name: 'All families' })).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no posts', async () => {
    vi.mocked(fetchPosts).mockResolvedValue({ items: [], nextCursor: null });
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    expect(await screen.findByText(/No posts yet/)).toBeInTheDocument();
  });

  it('offers Show more only when a next cursor exists', async () => {
    vi.mocked(fetchPosts).mockResolvedValue({ items: [makePost()], nextCursor: 'cursor-2' });
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });
});
