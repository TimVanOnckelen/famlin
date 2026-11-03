import userEvent from '@testing-library/user-event'
import { screen, within } from '@testing-library/react'
import { TripDetailPage } from '@/pages/TripDetailPage'
import { makeComment, makePost, makeTrip, makeUser, renderWithQueryClient } from '@/test/fixtures'
import { checkInTrip, fetchComments, fetchPost } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchPost: vi.fn(),
  checkInTrip: vi.fn(),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  reactToComment: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TripDetailPage', () => {
  it('shows the timeline newest-first and the trip-level comment separately while active', async () => {
    const post = makePost({
      id: 'trip-1',
      type: 'TRIP',
      content: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      trip: makeTrip({ startDate: '2026-07-03', closed: false, dayNumber: 4 }),
    })
    vi.mocked(fetchPost).mockResolvedValue(post)
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({
        id: 'ci-1',
        authorId: 'user-1',
        createdAt: '2026-07-04T09:00:00Z',
        metadata: { kind: 'trip_checkin', place: 'Florence', photoUrls: [], checkinId: 'ci-1' },
      }),
      makeComment({
        id: 'ci-2',
        authorId: 'user-1',
        createdAt: '2026-07-06T14:20:00Z',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [], checkinId: 'ci-2' },
      }),
      makeComment({ id: 'com-1', authorId: 'user-2', content: 'Have a great trip!' }),
    ])

    const { container } = renderWithQueryClient(
      <TripDetailPage user={makeUser()} postId="trip-1" onBack={() => {}} onLogout={() => {}} />
    )

    expect(await screen.findByText('Road trip Italy')).toBeInTheDocument()
    expect(screen.getByText('Timeline · newest first')).toBeInTheDocument()

    const places = Array.from(container.querySelectorAll('.trip-timeline-place')).map((el) => el.textContent)
    expect(screen.getByRole('button', { name: 'Check-in' }).closest('.trip-detail-empty')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Check-in' })).toHaveLength(1)
    expect(places).toEqual(['Bologna', 'Florence']) // newest (Bologna) first

    // The trip-level comment shows in its own section, not the timeline.
    expect(screen.getByText('Have a great trip!')).toBeInTheDocument()
    const timeline = container.querySelector('.trip-detail-timeline') as HTMLElement
    expect(within(timeline).queryByText('Have a great trip!')).not.toBeInTheDocument()
  })

  it('flips to oldest-first with the diary label and a closing line once the trip is closed', async () => {
    const post = makePost({
      id: 'trip-1',
      type: 'TRIP',
      content: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      trip: makeTrip({
        startDate: '2026-07-03',
        endDate: '2026-07-14',
        closed: true,
        closedAt: '2026-07-14T18:00:00Z',
        dayNumber: null,
        durationDays: 12,
      }),
    })
    vi.mocked(fetchPost).mockResolvedValue(post)
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({
        id: 'ci-1',
        authorId: 'user-1',
        createdAt: '2026-07-04T09:00:00Z',
        metadata: { kind: 'trip_checkin', place: 'Florence', photoUrls: [], checkinId: 'ci-1' },
      }),
      makeComment({
        id: 'ci-2',
        authorId: 'user-1',
        createdAt: '2026-07-06T14:20:00Z',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [], checkinId: 'ci-2' },
      }),
    ])

    const { container } = renderWithQueryClient(
      <TripDetailPage user={makeUser()} postId="trip-1" onBack={() => {}} onLogout={() => {}} />
    )

    expect(await screen.findByText('Diary · oldest first')).toBeInTheDocument()
    const places = Array.from(container.querySelectorAll('.trip-timeline-place')).map((el) => el.textContent)
    expect(places).toEqual(['Florence', 'Bologna']) // oldest first once closed

    expect(screen.getByText(/Trip closed by Grandpa John/)).toBeInTheDocument()
  })

  it('offers the first check-in to the author when the timeline is empty', async () => {
    const post = makePost({
      id: 'trip-1',
      type: 'TRIP',
      content: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      trip: makeTrip({ startDate: '2026-07-03', closed: false, dayNumber: 1, latestCheckin: null }),
    })
    vi.mocked(fetchPost).mockResolvedValue(post)
    vi.mocked(fetchComments).mockResolvedValue([])

    renderWithQueryClient(<TripDetailPage user={makeUser()} postId="trip-1" onBack={() => {}} onLogout={() => {}} />)

    expect(await screen.findByText('The trip has begun…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check-in' }).closest('.trip-detail-empty')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Check-in' })).toHaveLength(1)
  })
})

it.each([
  { viewer: 'author', closed: false, dayNumber: 1, allowed: true },
  { viewer: 'companion', closed: false, dayNumber: 1, allowed: true },
  { viewer: 'other', closed: false, dayNumber: 1, allowed: false },
  { viewer: 'author', closed: true, dayNumber: null, allowed: false },
  { viewer: 'companion', closed: true, dayNumber: null, allowed: false },
  { viewer: 'author', closed: false, dayNumber: null, allowed: false },
])('check-in access for $viewer, closed=$closed, day=$dayNumber', async ({ viewer, closed, dayNumber, allowed }) => {
  vi.mocked(fetchPost).mockResolvedValue(
    makePost({
      type: 'TRIP',
      authorId: 'author',
      trip: makeTrip({ closed, dayNumber, travelers: [{ id: 'companion', name: 'Anna', avatarUrl: null }] }),
    })
  )
  vi.mocked(fetchComments).mockResolvedValue([])
  renderWithQueryClient(
    <TripDetailPage user={makeUser({ id: viewer })} postId="trip-1" onBack={() => {}} onLogout={() => {}} />
  )
  await screen.findByText('Road trip Italy')
  expect(!!screen.queryByRole('button', { name: 'Check-in' })).toBe(allowed)
})

it('adds a check-in and refreshes the timeline and trip statistics', async () => {
  const initial = makePost({
    id: 'trip-1',
    type: 'TRIP',
    authorId: 'author',
    trip: makeTrip({ stopCount: 0, latestCheckin: null }),
  })
  vi.mocked(fetchPost).mockResolvedValue(initial)
  vi.mocked(fetchComments).mockResolvedValue([])
  vi.mocked(checkInTrip).mockImplementation(async () => {
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({
        id: 'new-checkin',
        authorId: 'author',
        createdAt: '2026-07-06T12:00:00Z',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [], checkinId: 'new-checkin' },
      }),
    ])
    return {
      ...initial,
      trip: makeTrip({
        stopCount: 1,
        latestCheckin: { commentId: 'new-checkin', place: 'Bologna', createdAt: '2026-07-06T12:00:00Z' },
      }),
    }
  })
  const { queryClient } = renderWithQueryClient(
    <TripDetailPage user={makeUser({ id: 'author' })} postId="trip-1" onBack={() => {}} onLogout={() => {}} />
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Check-in' }))
  await user.type(screen.getByPlaceholderText('E.g. Bologna'), 'Bologna')
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  expect(await screen.findByText('Bologna')).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Check-in' })).not.toBeInTheDocument()
  expect(queryClient.getQueryData(['post', 'trip-1'])).toMatchObject({ trip: { stopCount: 1 } })
})
