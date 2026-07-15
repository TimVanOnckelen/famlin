import { screen } from '@testing-library/react';
import { PhotosPage } from '@/pages/PhotosPage';
import { makeUser, renderWithQueryClient } from '@/test/fixtures';
import { fetchGroups, getGroupPhotoTimeline, getGroupMediaPeople } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  getGroupPhotoTimeline: vi.fn(),
  getGroupMediaPeople: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}));

// Mock IntersectionObserver for tests
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  disconnect() {}
  unobserve() {}
} as any;

const groups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'group-2', name: 'Neefjes', createdAt: '2026-01-01T00:00:00Z' },
];

const people = [
  { id: 'person-1', provider: 'immich', label: 'Emma', userId: null },
  { id: 'person-2', provider: 'immich', label: 'John', userId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGroups).mockResolvedValue(groups);
  vi.mocked(getGroupMediaPeople).mockResolvedValue(people);
  vi.mocked(getGroupPhotoTimeline).mockResolvedValue({ items: [], nextCursor: null });
});

describe('PhotosPage', () => {
  it('shows every family by default (no group filter sent)', async () => {
    vi.mocked(getGroupPhotoTimeline).mockResolvedValue({
      items: [
        {
          id: 'photo-1',
          source: 'album',
          type: 'IMAGE',
          takenAt: '2026-07-10T10:00:00Z',
          width: 1920,
          height: 1080,
          thumbnailUrl: '/api/media/assets/link-1/asset-1/thumbnail.jpg',
          previewUrl: '/api/media/assets/link-1/asset-1/preview.jpg',
          originalUrl: '/api/media/assets/link-1/asset-1/original.jpg',
          albumName: 'Summer 2026',
          linkId: 'link-1',
          assetId: 'asset-1',
        },
      ],
      nextCursor: null,
    });

    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
    );

    await screen.findByText('July 2026');
    expect(getGroupPhotoTimeline).toHaveBeenCalledWith('group-1', {
      cursor: undefined,
      personId: undefined,
    });
  });

  it('renders person filter chips when people are available', async () => {
    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
    );

    await screen.findByRole('button', { name: 'Emma' });
    expect(screen.getByRole('button', { name: 'All people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
  });

  it('groups photos by month', async () => {
    vi.mocked(getGroupPhotoTimeline).mockResolvedValue({
      items: [
        {
          id: 'photo-1',
          source: 'album',
          type: 'IMAGE',
          takenAt: '2026-07-10T10:00:00Z',
          width: 1920,
          height: 1080,
          thumbnailUrl: '/api/media/assets/link-1/asset-1/thumbnail.jpg',
          previewUrl: '/api/media/assets/link-1/asset-1/preview.jpg',
          originalUrl: '/api/media/assets/link-1/asset-1/original.jpg',
        },
        {
          id: 'photo-2',
          source: 'album',
          type: 'IMAGE',
          takenAt: '2026-06-15T14:30:00Z',
          width: 1920,
          height: 1080,
          thumbnailUrl: '/api/media/assets/link-1/asset-2/thumbnail.jpg',
          previewUrl: '/api/media/assets/link-1/asset-2/preview.jpg',
          originalUrl: '/api/media/assets/link-1/asset-2/original.jpg',
        },
      ],
      nextCursor: null,
    });

    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
    );

    await screen.findByText('July 2026');
    expect(screen.getByText('June 2026')).toBeInTheDocument();
  });

  it('shows the empty state when there are no photos', async () => {
    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
    );

    expect(await screen.findByText('No photos yet')).toBeInTheDocument();
  });

  it('shows video play icon for video items', async () => {
    vi.mocked(getGroupPhotoTimeline).mockResolvedValue({
      items: [
        {
          id: 'video-1',
          source: 'album',
          type: 'VIDEO',
          takenAt: '2026-07-10T10:00:00Z',
          width: 1920,
          height: 1080,
          thumbnailUrl: '/api/media/assets/link-1/asset-1/thumbnail.jpg',
          previewUrl: '/api/media/assets/link-1/asset-1/preview.jpg',
          originalUrl: '/api/media/assets/link-1/asset-1/original.mp4',
        },
      ],
      nextCursor: null,
    });

    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
    );

    await screen.findByText('July 2026');
    // The play icon is rendered as part of the photo tile
    const playIcon = screen.getByText('▶');
    expect(playIcon).toBeInTheDocument();
  });
});
