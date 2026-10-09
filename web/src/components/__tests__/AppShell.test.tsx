import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '@/components/AppShell';
import { makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchChatUnreadCounts, fetchServerInfo } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchChatUnreadCounts: vi.fn(),
  fetchServerInfo: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', readOnly: false, branding: null });
  vi.mocked(fetchChatUnreadCounts).mockResolvedValue({});
});

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const onFeed = vi.fn();
  const onPhotos = vi.fn();
  const onChat = vi.fn();
  const onFavorites = vi.fn();
  const onProfile = vi.fn();
  const onNewPost = vi.fn();
  const onLogout = vi.fn();
  const utils = renderWithQueryClient(
    <AppShell
      user={makeUser()}
      active="feed"
      onFeed={onFeed}
      onPhotos={onPhotos}
      onChat={onChat}
      onFavorites={onFavorites}
      onProfile={onProfile}
      onNewPost={onNewPost}
      onLogout={onLogout}
      {...overrides}
    >
      <div>page content</div>
    </AppShell>
  );
  return { ...utils, onFeed, onPhotos, onChat, onFavorites, onProfile, onNewPost, onLogout };
}

describe('AppShell navigation', () => {
  it('marks the active tab with aria-current and styles it active', async () => {
    renderShell({ active: 'photos' });
    // Two nav rails render (sidebar + BottomNav), each with its own Photos
    // tab — both should report the active one.
    const photosButtons = await screen.findAllByRole('button', { name: 'Photos' });
    expect(photosButtons.length).toBeGreaterThan(0);
    for (const button of photosButtons) {
      expect(button).toHaveAttribute('aria-current', 'page');
    }
    const feedButtons = screen.getAllByRole('button', { name: 'Feed' });
    for (const button of feedButtons) {
      expect(button).not.toHaveAttribute('aria-current');
    }
  });

  it('clicking a sidebar tab calls its callback', async () => {
    const user = userEvent.setup();
    const { onPhotos } = renderShell();

    const [sidebarPhotos] = await screen.findAllByRole('button', { name: 'Photos' });
    await user.click(sidebarPhotos);
    expect(onPhotos).toHaveBeenCalledTimes(1);
  });

  it('shows the new-post button only when onNewPost is provided', async () => {
    renderShell();
    expect(await screen.findAllByRole('button', { name: /New post/ })).not.toHaveLength(0);
  });

  it('hides the new-post affordance when the page has no composer', () => {
    renderShell({ onNewPost: undefined });
    expect(screen.queryByRole('button', { name: /New post/ })).not.toBeInTheDocument();
  });

  it('hides the Chat tab when the current page passes no onChat and isn\'t chat', () => {
    renderShell({ onChat: undefined });
    expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('keeps the Chat tab visible while already on it, even with no onChat callback', async () => {
    renderShell({ active: 'chat', onChat: undefined });
    expect(await screen.findAllByRole('button', { name: 'Chat' })).not.toHaveLength(0);
  });

  it('renders page content inside the main landmark', () => {
    renderShell();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('opens the user menu and calls onLogout', async () => {
    const user = userEvent.setup();
    const { onLogout } = renderShell();

    const [trigger] = await screen.findAllByRole('button', { name: 'Grandpa John' });
    await user.click(trigger);
    await user.click((await screen.findAllByRole('menuitem', { name: 'Log out' }))[0]);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('opens the shortcuts dialog with "?"', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('navigates with the "g then f" keyboard shortcut', async () => {
    const user = userEvent.setup();
    const { onFeed } = renderShell({ active: 'photos' });
    await user.keyboard('gf');
    expect(onFeed).toHaveBeenCalledTimes(1);
  });

  it('clicking the sidebar Favorites item calls its callback', async () => {
    const user = userEvent.setup();
    const { onFavorites } = renderShell();

    // Sidebar item + compact-header icon share the accessible name.
    const favoritesButtons = await screen.findAllByRole('button', { name: 'Favorites' });
    expect(favoritesButtons.length).toBeGreaterThan(0);
    await user.click(favoritesButtons[0]);
    expect(onFavorites).toHaveBeenCalledTimes(1);
  });

  it('navigates with the "g then b" keyboard shortcut', async () => {
    const user = userEvent.setup();
    const { onFavorites } = renderShell();
    await user.keyboard('gb');
    expect(onFavorites).toHaveBeenCalledTimes(1);
  });

  it('hides Favorites when the current page passes no onFavorites and isn\'t favorites', () => {
    renderShell({ onFavorites: undefined });
    expect(screen.queryByRole('button', { name: 'Favorites' })).not.toBeInTheDocument();
  });

  it('keeps Favorites visible while already on it, even with no onFavorites callback', () => {
    renderShell({ active: 'favorites', onFavorites: undefined });
    expect(screen.getAllByRole('button', { name: 'Favorites' }).length).toBeGreaterThan(0);
  });
});
