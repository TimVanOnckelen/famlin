import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedPage } from '@/pages/FeedPage';
import { makePost, makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchGroups, fetchPosts } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchPosts: vi.fn(),
}));

const groups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'group-2', name: 'Neefjes', createdAt: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGroups).mockResolvedValue(groups);
  vi.mocked(fetchPosts).mockResolvedValue({ items: [makePost()], nextCursor: null });
});

describe('FeedPage', () => {
  it('shows every family by default (no group filter sent)', async () => {
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);
    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(fetchPosts).toHaveBeenCalledWith({ groupIds: [], cursor: undefined });
  });

  it('filters to one family and back to all', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Neefjes' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-2'], cursor: undefined })
    );

    await user.click(screen.getByRole('button', { name: 'All families' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenLastCalledWith({ groupIds: [], cursor: undefined })
    );
  });

  it('selects multiple families at once', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Familie de Vries' }));
    await user.click(screen.getByRole('button', { name: 'Neefjes' }));
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-1', 'group-2'], cursor: undefined })
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
