import { prepareAvatar } from '@/utils/avatar-image'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from '@/pages/ProfilePage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'
import {
  downloadMyExport,
  fetchCalendarFeed,
  fetchNotificationConfig,
  fetchServerInfo,
  updateMe,
  uploadFiles,
} from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchNotificationConfig: vi.fn(),
  fetchServerInfo: vi.fn(),
  updateMe: vi.fn(),
  downloadMyExport: vi.fn(),
  uploadFiles: vi.fn(),
  fetchCalendarFeed: vi.fn(),
}))

vi.mock('@/utils/avatar-image', async (original) => ({
  ...(await original<typeof import('@/utils/avatar-image')>()),
  prepareAvatar: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchNotificationConfig).mockResolvedValue({ pushEnabled: true, emailEnabled: true })
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.2.3' })
  vi.mocked(updateMe).mockImplementation(async (data) => ({ ...makeUser(), ...data }))
})

describe('ProfilePage', () => {
  it("downloads the data export as a zip and says it includes everyone's posts", async () => {
    const user = userEvent.setup()
    vi.mocked(downloadMyExport).mockResolvedValue(new Blob(['PK'], { type: 'application/zip' }))
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    expect(screen.getByText(/includes posts from everyone in your groups/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download my data' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(downloadMyExport).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    click.mockRestore()
  })

  it('explains a rate-limited export', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadMyExport).mockRejectedValue({ response: { status: 429 } })

    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('try again in an hour')
  })

  it('shows the calendar subscription section only on servers that support it', async () => {
    const { unmount } = renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    expect(await screen.findByText('Server version 1.2.3')).toBeInTheDocument()
    expect(screen.queryByText('Calendar subscription')).not.toBeInTheDocument()
    expect(fetchCalendarFeed).not.toHaveBeenCalled()
    unmount()

    vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.2.3', features: ['calendarFeed'] })
    vi.mocked(fetchCalendarFeed).mockResolvedValue({ enabled: false, createdAt: null, lastUsedAt: null })
    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    expect(await screen.findByText('Calendar subscription')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Create subscription link' })).toBeInTheDocument()
  })

  it('shows the user identity and server version', async () => {
    const { container } = renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    // "Grandpa John" also appears in AppShell's sidebar user menu now, so
    // scope to the profile card itself.
    const profileCard = container.querySelector('.profile-card') as HTMLElement
    expect(within(profileCard).getByText('Grandpa John')).toBeInTheDocument()
    expect(within(profileCard).getByText('john@example.com')).toBeInTheDocument()
    expect(await screen.findByText('Server version 1.2.3')).toBeInTheDocument()
  })

  it('shows the admin badge only for admins', () => {
    const { unmount } = renderWithQueryClient(
      <ProfilePage user={makeUser({ isAdmin: true })} onBack={() => {}} onLogout={() => {}} />
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
    unmount()

    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('saves a notification preference when a switch is toggled', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(
      <ProfilePage user={makeUser({ pushOnNewPost: false })} onBack={() => {}} onLogout={() => {}} />
    )

    await user.click(await screen.findByRole('switch', { name: 'New posts — Push' }))
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ pushOnNewPost: true }))
  })

  it('shows and saves the direct-message push preference on capable servers', async () => {
    vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', features: ['directMessages'] })
    renderWithQueryClient(
      <ProfilePage user={makeUser({ pushOnDirectMessage: false })} onBack={() => {}} onLogout={() => {}} />
    )

    await userEvent.click(await screen.findByRole('switch', { name: 'Direct messages — Push' }))
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ pushOnDirectMessage: true }))
  })

  it('hides the push column when the server has no push configured', async () => {
    vi.mocked(fetchNotificationConfig).mockResolvedValue({ pushEnabled: false, emailEnabled: true })
    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)

    expect(await screen.findByRole('switch', { name: 'New posts — Email' })).toBeInTheDocument()
    // Both columns show while the config is still loading — wait for it.
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'New posts — Push' })).not.toBeInTheDocument())
  })

  it('has no back button (a top-level tab) and navigates to the feed via the nav', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onLogout = vi.fn()
    renderWithQueryClient(<ProfilePage user={makeUser()} onBack={onBack} onLogout={onLogout} />)

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Feed' })[0])
    expect(onBack).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalled()
  })
})

it('uploads only the compressed crop after confirmation and allows choosing the same file again after cancellation', async () => {
  const user = userEvent.setup()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:profile-photo'), revokeObjectURL: vi.fn() })
  const compressed = new File(['jpeg'], 'avatar.jpg', { type: 'image/jpeg' })
  vi.mocked(prepareAvatar).mockResolvedValue(compressed)
  vi.mocked(uploadFiles).mockResolvedValue(['/uploads/avatar.jpg'])
  const { container } = renderWithQueryClient(<ProfilePage user={makeUser()} onBack={() => {}} onLogout={() => {}} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const original = new File(['4k png'], 'photo.png', { type: 'image/png' })
  await user.upload(input, original)
  expect(screen.getByRole('dialog', { name: 'Crop profile photo' })).toBeInTheDocument()
  expect(uploadFiles).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(updateMe).not.toHaveBeenCalled()
  await user.upload(input, original)
  const image = screen.getByAltText('Profile photo preview')
  Object.defineProperties(image, { naturalWidth: { value: 4000 }, naturalHeight: { value: 3000 } })
  fireEvent.load(image)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(uploadFiles).toHaveBeenCalledWith([compressed]))
  await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ avatarUrl: '/uploads/avatar.jpg' }))
})
