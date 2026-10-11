import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { FavoritesPage } from '@/pages/FavoritesPage';
import { makePost, makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchFavorites } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchFavorites: vi.fn(),
}));

// Same probe as FeedPage's tests: asserts the background-location navigation
// the card click performs, without mounting the real App route tree.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}|{JSON.stringify(location.state)}</div>;
}

function renderPage() {
  renderWithQueryClient(
    <>
      <FavoritesPage user={makeUser()} onBack={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />
      <LocationProbe />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchFavorites).mockResolvedValue({ items: [makePost()], nextCursor: null });
});

describe('FavoritesPage', () => {
  it('lists the favorited posts across families (group tag always on)', async () => {
    renderPage();

    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument();
    expect(fetchFavorites).toHaveBeenCalledWith(undefined);
  });

  it('shows the empty state when nothing is favorited', async () => {
    vi.mocked(fetchFavorites).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('No favorites yet')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('offers Show more only when a next cursor exists and fetches with it', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFavorites)
      .mockResolvedValueOnce({ items: [makePost({ id: 'post-1' })], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [makePost({ id: 'post-2', content: 'Second favorite' })], nextCursor: null });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Show more' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Second favorite')).toBeInTheDocument();
    expect(fetchFavorites).toHaveBeenLastCalledWith('cursor-2');
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  describe('opening the post detail modal', () => {
    it('clicking a card opens the detail modal (background-location navigation)', async () => {
      const user = userEvent.setup();
      renderPage();

      const card = await screen.findByRole('article');
      await user.click(card);

      const probe = screen.getByTestId('location-probe');
      expect(probe.textContent).toContain('/posts/post-1');
      expect(probe.textContent).toContain('backgroundLocation');
    });

    it('clicking the comment count also opens the detail modal', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: /comments/ }));

      expect(screen.getByTestId('location-probe').textContent).toContain('/posts/post-1');
    });

    it('does not open the modal when clicking the reaction button', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: /^0$/ }));

      expect(screen.getByTestId('location-probe').textContent).toBe('/|null');
    });
  });
});
