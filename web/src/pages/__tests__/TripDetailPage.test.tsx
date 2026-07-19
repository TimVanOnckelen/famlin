import { screen, within } from '@testing-library/react';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { makeComment, makePost, makeTrip, renderWithQueryClient } from '@/test/fixtures';
import { fetchComments, fetchPost } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchPost: vi.fn(),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  reactToComment: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TripDetailPage', () => {
  it('shows the timeline newest-first and the trip-level comment separately while active', async () => {
    const post = makePost({
      id: 'trip-1',
      type: 'TRIP',
      content: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      trip: makeTrip({ startDate: '2026-07-03', closed: false, dayNumber: 4 }),
    });
    vi.mocked(fetchPost).mockResolvedValue(post);
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({
        id: 'ci-1',
        authorId: 'user-1',
        createdAt: '2026-07-04T09:00:00Z',
        metadata: { kind: 'trip_checkin', place: 'Florence', photoUrls: [] },
      }),
      makeComment({
        id: 'ci-2',
        authorId: 'user-1',
        createdAt: '2026-07-06T14:20:00Z',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [] },
      }),
      makeComment({ id: 'com-1', authorId: 'user-2', content: 'Have a great trip!' }),
    ]);

    const { container } = renderWithQueryClient(<TripDetailPage postId="trip-1" onBack={() => {}} />);

    expect(await screen.findByText('Road trip Italy')).toBeInTheDocument();
    expect(screen.getByText('Timeline · newest first')).toBeInTheDocument();

    const places = Array.from(container.querySelectorAll('.trip-timeline-place')).map((el) => el.textContent);
    expect(places).toEqual(['Bologna', 'Florence']); // newest (Bologna) first

    // The trip-level comment shows in its own section, not the timeline.
    expect(screen.getByText('Have a great trip!')).toBeInTheDocument();
    const timeline = container.querySelector('.trip-detail-timeline') as HTMLElement;
    expect(within(timeline).queryByText('Have a great trip!')).not.toBeInTheDocument();
  });

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
    });
    vi.mocked(fetchPost).mockResolvedValue(post);
    vi.mocked(fetchComments).mockResolvedValue([
      makeComment({
        id: 'ci-1',
        authorId: 'user-1',
        createdAt: '2026-07-04T09:00:00Z',
        metadata: { kind: 'trip_checkin', place: 'Florence', photoUrls: [] },
      }),
      makeComment({
        id: 'ci-2',
        authorId: 'user-1',
        createdAt: '2026-07-06T14:20:00Z',
        metadata: { kind: 'trip_checkin', place: 'Bologna', photoUrls: [] },
      }),
    ]);

    const { container } = renderWithQueryClient(<TripDetailPage postId="trip-1" onBack={() => {}} />);

    expect(await screen.findByText('Diary · oldest first')).toBeInTheDocument();
    const places = Array.from(container.querySelectorAll('.trip-timeline-place')).map((el) => el.textContent);
    expect(places).toEqual(['Florence', 'Bologna']); // oldest first once closed

    expect(screen.getByText(/Trip closed by Grandpa John/)).toBeInTheDocument();
  });

  it('shows the empty state with no check-in CTA when the trip has no check-ins yet', async () => {
    const post = makePost({
      id: 'trip-1',
      type: 'TRIP',
      content: null,
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      trip: makeTrip({ startDate: '2026-07-03', closed: false, dayNumber: 1, latestCheckin: null }),
    });
    vi.mocked(fetchPost).mockResolvedValue(post);
    vi.mocked(fetchComments).mockResolvedValue([]);

    renderWithQueryClient(<TripDetailPage postId="trip-1" onBack={() => {}} />);

    expect(await screen.findByText('The trip has begun…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check-in/i })).not.toBeInTheDocument();
  });
});
