import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { useAuthStore } from '@/stores/authStore';
import { makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchMe } from '@famlin/api-client';

// Routing only: every page is a stub that names itself and exposes the
// callbacks App.tsx wires up, so these tests pin the URL map and the
// session-reset rule without depending on any page's own data fetching.
vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchMe: vi.fn(),
  ensureFreshMediaToken: vi.fn(),
  fetchServerInfo: vi.fn().mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null }),
}));
vi.mock('@/components/ReadOnlyBanner', () => ({ ReadOnlyBanner: () => null }));
vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <div>login page</div> }));
vi.mock('@/pages/FeedPage', () => ({
  FeedPage: (p: { onOpenTrip: (id: string) => void; onOpenProfile: () => void }) => (
    <div>
      feed page
      <button onClick={() => p.onOpenTrip('trip-9')}>open trip</button>
      <button onClick={() => p.onOpenProfile()}>open profile</button>
    </div>
  ),
}));
vi.mock('@/pages/ProfilePage', () => ({
  ProfilePage: (p: { onLogout: () => void }) => (
    <div>
      profile page<button onClick={() => p.onLogout()}>log out</button>
    </div>
  ),
}));
vi.mock('@/pages/PhotosPage', () => ({ PhotosPage: () => <div>photos page</div> }));
vi.mock('@/pages/ChatPage', () => ({ ChatPage: () => <div>chat page</div> }));
vi.mock('@/pages/FavoritesPage', () => ({ FavoritesPage: () => <div>favorites page</div> }));
vi.mock('@/pages/TripDetailPage', () => ({
  TripDetailPage: (p: { postId: string; onBack: () => void }) => (
    <div>
      trip page {p.postId}
      <button onClick={() => p.onBack()}>back</button>
    </div>
  ),
}));
vi.mock('@/pages/AlbumDetailPage', () => ({
  AlbumDetailPage: (p: { postId: string }) => <div>album page {p.postId}</div>,
}));
vi.mock('@/pages/PostDetailPage', () => ({
  PostDetailPage: (p: { postId: string }) => <div>post page {p.postId}</div>,
}));

const me = { ...makeUser(), groups: [] };

function signIn() {
  useAuthStore.setState({
    user: null,
    token: null,
    isLoading: true,
    loadToken: async () => {
      useAuthStore.setState({ isLoading: false });
      return 'token';
    },
    setAuth: async (user, token) => useAuthStore.setState({ user, token, isLoading: false }),
    logout: async () => useAuthStore.setState({ user: null, token: null, isLoading: false }),
  });
}

function signedOut() {
  useAuthStore.setState({
    user: null,
    token: null,
    isLoading: true,
    loadToken: async () => {
      useAuthStore.setState({ isLoading: false });
      return null;
    },
    setAuth: async (user, token) => useAuthStore.setState({ user, token, isLoading: false }),
    logout: async () => useAuthStore.setState({ user: null, token: null, isLoading: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('App routing', () => {
  it.each([
    ['/', 'feed page'],
    ['/photos', 'photos page'],
    ['/chat', 'chat page'],
    ['/profile', 'profile page'],
    ['/favorites', 'favorites page'],
    ['/trips/trip-1', 'trip page trip-1'],
    ['/albums/album-1', 'album page album-1'],
    ['/posts/post-1', 'post page post-1'],
  ])('renders %s', async (route, text) => {
    signIn();
    renderWithQueryClient(<App />, { route });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('sends an unknown path to the feed', async () => {
    signIn();
    renderWithQueryClient(<App />, { route: '/no/such/page' });
    expect(await screen.findByText('feed page')).toBeInTheDocument();
  });

  it('navigates between pages and back', async () => {
    const user = userEvent.setup();
    signIn();
    renderWithQueryClient(<App />);
    await user.click(await screen.findByRole('button', { name: 'open trip' }));
    expect(screen.getByText('trip page trip-9')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByText('feed page')).toBeInTheDocument();
  });

  it('keeps a deep link through a fresh login', async () => {
    signedOut();
    renderWithQueryClient(<App />, { route: '/posts/shared-1' });
    expect(await screen.findByText('login page')).toBeInTheDocument();

    await act(() => useAuthStore.getState().setAuth(me, 'token'));
    expect(screen.getByText('post page shared-1')).toBeInTheDocument();
  });

  it('does not land the next login back on the page a session ended on', async () => {
    const user = userEvent.setup();
    signIn();
    renderWithQueryClient(<App />, { route: '/profile' });
    await user.click(await screen.findByRole('button', { name: 'log out' }));
    expect(screen.getByText('login page')).toBeInTheDocument();

    await act(() => useAuthStore.getState().setAuth(me, 'token'));
    expect(screen.getByText('feed page')).toBeInTheDocument();
  });
});
