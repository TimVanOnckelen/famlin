import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '@/pages/ProfilePage';
import { makeUser, renderWithQueryClient } from '@/test/fixtures';
import { downloadMyExport, fetchNotificationConfig, fetchServerInfo, updateMe } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchNotificationConfig: vi.fn(),
  fetchServerInfo: vi.fn(),
  updateMe: vi.fn(),
  downloadMyExport: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchNotificationConfig).mockResolvedValue({ pushEnabled: true, emailEnabled: true });
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.2.3' });
  vi.mocked(updateMe).mockImplementation(async (data) => ({ ...makeUser(), ...data }));
});

describe('ProfilePage', () => {
  it('downloads the data export as a zip and says it includes everyone\'s posts', async () => {
    const user = userEvent.setup();
    vi.mocked(downloadMyExport).mockResolvedValue(new Blob(['PK'], { type: 'application/zip' }));
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />);
    expect(screen.getByText(/includes posts from everyone in your groups/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(downloadMyExport).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    click.mockRestore();
  });

  it('explains a rate-limited export', async () => {
    const user = userEvent.setup();
    vi.mocked(downloadMyExport).mockRejectedValue({ response: { status: 429 } });

    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('try again in an hour');
  });

  it('shows the user identity and server version', async () => {
    renderWithQueryClient(
      <ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />
    );
    expect(screen.getByText('Grandpa John')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Server version 1.2.3')).toBeInTheDocument();
  });

  it('shows the admin badge only for admins', () => {
    const { unmount } = renderWithQueryClient(
      <ProfilePage user={makeUser({ isAdmin: true })} onBack={() => {}} onLogout={() => {}} />
    );
    expect(screen.getByText('Admin')).toBeInTheDocument();
    unmount();

    renderWithQueryClient(
      <ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />
    );
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('saves a notification preference when a switch is toggled', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <ProfilePage
        user={makeUser({ pushOnNewPost: false })}
        onBack={() => {}}
        onLogout={() => {}}
      />
    );

    await user.click(await screen.findByRole('switch', { name: 'New posts — Push' }));
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ pushOnNewPost: true }));
  });

  it('hides the push column when the server has no push configured', async () => {
    vi.mocked(fetchNotificationConfig).mockResolvedValue({ pushEnabled: false, emailEnabled: true });
    renderWithQueryClient(
      <ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />
    );

    expect(await screen.findByRole('switch', { name: 'New posts — Email' })).toBeInTheDocument();
    // Both columns show while the config is still loading — wait for it.
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'New posts — Push' })).not.toBeInTheDocument()
    );
  });

  it('navigates back and logs out', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onLogout = vi.fn();
    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={onBack} onLogout={onLogout} />);

    await user.click(screen.getByRole('button', { name: 'Back to the feed' }));
    expect(onBack).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
