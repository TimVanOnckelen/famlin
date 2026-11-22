import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarFeedSection } from '@/components/CalendarFeedSection'
import { renderWithQueryClient } from '@/test/fixtures'
import { createCalendarFeed, fetchCalendarFeed, revokeCalendarFeed, ServerInfo } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchCalendarFeed: vi.fn(),
  createCalendarFeed: vi.fn(),
  revokeCalendarFeed: vi.fn(),
}))

const supported: ServerInfo = { version: '1.0.0', features: ['calendarFeed'] }
const feedUrl = 'https://famlin.example.com/api/calendar/secret-token/famlin.ics'
const created = {
  url: feedUrl,
  webcalUrl: 'webcal://famlin.example.com/api/calendar/secret-token/famlin.ics',
  createdAt: '2026-11-22T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CalendarFeedSection', () => {
  it('is hidden and never calls the API when the server lacks the feature', () => {
    const { container, unmount } = renderWithQueryClient(<CalendarFeedSection serverInfo={{ version: '0.8.7' }} />)
    expect(container).toBeEmptyDOMElement()
    unmount()

    const second = renderWithQueryClient(
      <CalendarFeedSection serverInfo={{ version: '1.0.0', features: ['memberExport'] }} />
    )
    expect(second.container).toBeEmptyDOMElement()
    expect(fetchCalendarFeed).not.toHaveBeenCalled()
  })

  it('creates a link, shows the URL once with copy and webcal link', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCalendarFeed)
      .mockResolvedValueOnce({ enabled: false, createdAt: null, lastUsedAt: null })
      .mockResolvedValue({ enabled: true, createdAt: created.createdAt, lastUsedAt: null })
    vi.mocked(createCalendarFeed).mockResolvedValue(created)

    const { unmount } = renderWithQueryClient(<CalendarFeedSection serverInfo={supported} />)
    await user.click(await screen.findByRole('button', { name: 'Create subscription link' }))

    const input = await screen.findByLabelText('Your subscription link')
    expect(input).toHaveValue(feedUrl)
    expect(input).toHaveAttribute('readonly')
    expect(screen.getByText(/only shown once/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in calendar app' })).toHaveAttribute('href', created.webcalUrl)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(feedUrl)

    // Once enabled the status (and its actions) show, and the URL is gone on
    // the next visit since the server can't return it again.
    expect(await screen.findByRole('button', { name: 'Regenerate link' })).toBeInTheDocument()
    unmount()
    renderWithQueryClient(<CalendarFeedSection serverInfo={supported} />)
    expect(await screen.findByText('Not used by a calendar app yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your subscription link')).not.toBeInTheDocument()
  })

  it('regenerates only after confirming', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCalendarFeed).mockResolvedValue({
      enabled: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      lastUsedAt: '2026-11-20T10:00:00.000Z',
    })
    vi.mocked(createCalendarFeed).mockResolvedValue(created)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    renderWithQueryClient(<CalendarFeedSection serverInfo={supported} />)
    expect(await screen.findByText(/^Last used/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regenerate link' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('old link stops working'))
    expect(createCalendarFeed).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Regenerate link' }))
    expect(await screen.findByLabelText('Your subscription link')).toHaveValue(feedUrl)
    expect(createCalendarFeed).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('turns the subscription off after confirming', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCalendarFeed)
      .mockResolvedValueOnce({ enabled: true, createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null })
      .mockResolvedValue({ enabled: false, createdAt: null, lastUsedAt: null })
    vi.mocked(revokeCalendarFeed).mockResolvedValue()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderWithQueryClient(<CalendarFeedSection serverInfo={supported} />)
    await user.click(await screen.findByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(revokeCalendarFeed).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Create subscription link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('shows an error when creating fails', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCalendarFeed).mockResolvedValue({ enabled: false, createdAt: null, lastUsedAt: null })
    vi.mocked(createCalendarFeed).mockRejectedValue(new Error('boom'))

    renderWithQueryClient(<CalendarFeedSection serverInfo={supported} />)
    await user.click(await screen.findByRole('button', { name: 'Create subscription link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be created")
  })
})
