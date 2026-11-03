import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhotosPage } from '@/pages/PhotosPage'
import { makeAlbum, makePost, makeUser, renderWithQueryClient } from '@/test/fixtures'
import {
  fetchAlbumPosts,
  fetchGroups,
  getGroupPhotoTimeline,
  getGroupMediaPeople,
  fetchUploadProcessing,
} from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchAlbumPosts: vi.fn(),
  fetchUploadProcessing: vi.fn(),
  fetchGroups: vi.fn(),
  getGroupPhotoTimeline: vi.fn(),
  getGroupMediaPeople: vi.fn(),
  getUploadUrl: vi.fn((url: string) => `http://localhost:3000${url}`),
}))

// Mock IntersectionObserver for tests
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  disconnect() {}
  unobserve() {}
} as any

const groups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
  { id: 'group-2', name: 'Neefjes', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
]

const people = [
  { id: 'person-1', provider: 'immich', label: 'Emma', userId: null },
  { id: 'person-2', provider: 'immich', label: 'John', userId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroups).mockResolvedValue(groups)
  vi.mocked(getGroupMediaPeople).mockResolvedValue(people)
  vi.mocked(getGroupPhotoTimeline).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(fetchAlbumPosts).mockResolvedValue({ items: [], nextCursor: null })
})

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
    })

    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await screen.findByText('July 2026')
    expect(getGroupPhotoTimeline).toHaveBeenCalledWith('group-1', {
      cursor: undefined,
      personId: undefined,
    })
  })

  it('renders person filter chips when people are available', async () => {
    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await screen.findByRole('button', { name: 'Emma' })
    expect(screen.getByRole('button', { name: 'All people' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emma' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument()
  })

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
    })

    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await screen.findByText('July 2026')
    expect(screen.getByText('June 2026')).toBeInTheDocument()
  })

  it('shows the empty state when there are no photos', async () => {
    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    expect(await screen.findByText('No photos yet')).toBeInTheDocument()
  })

  it('shows the shared albums strip for the active group and opens an album', async () => {
    const onOpenAlbum = vi.fn()
    vi.mocked(fetchAlbumPosts).mockResolvedValue({
      items: [
        makePost({
          id: 'album-post-1',
          type: 'ALBUM',
          album: makeAlbum({ title: 'Summer at the lake', photoCount: 5, contributorCount: 2 }),
        }),
      ],
      nextCursor: null,
    })

    renderWithQueryClient(
      <PhotosPage user={makeUser()} onOpenProfile={() => {}} onOpenAlbum={onOpenAlbum} onLogout={() => {}} />
    )

    const tile = await screen.findByRole('button', { name: /Summer at the lake/ })
    expect(screen.getByText('Shared albums')).toBeInTheDocument()
    expect(fetchAlbumPosts).toHaveBeenCalledWith({ groupIds: ['group-1'] })

    await userEvent.click(tile)
    expect(onOpenAlbum).toHaveBeenCalledWith('album-post-1')
  })

  it('hides the albums section when the group has no albums', async () => {
    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await screen.findByText('No photos yet')
    expect(screen.queryByText('Shared albums')).not.toBeInTheDocument()
  })

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
    })

    renderWithQueryClient(<PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await screen.findByText('July 2026')
    // The play icon is rendered as part of the photo tile
    const tile = screen.getByRole('button', { name: 'Open photo' })
    expect(tile.querySelector('.media-video-play')).toBeInTheDocument()
    expect(tile.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost:3000/api/media/assets/link-1/asset-1/thumbnail.jpg'
    )
    expect(tile.querySelector('video')).toBeNull()
  })
})

it('uses video posters and Live Photo controls for uploaded media, then autoplays the opened media', async () => {
  const videoUrl = '/uploads/11111111-1111-4111-8111-111111111111.mp4'
  const photoUrl = '/uploads/22222222-2222-4222-8222-222222222222.jpg'
  const motionUrl = '/uploads/33333333-3333-4333-8333-333333333333.mp4'
  vi.mocked(getGroupPhotoTimeline).mockResolvedValue({
    items: [videoUrl, photoUrl].map((url, index) => ({
      id: `post-photo-${index}`,
      source: 'post',
      type: index === 0 ? 'VIDEO' : 'IMAGE',
      takenAt: '2026-07-10T10:00:00Z',
      width: null,
      height: null,
      thumbnailUrl: url,
      previewUrl: url,
      originalUrl: url,
    })),
    nextCursor: null,
  })
  vi.mocked(fetchUploadProcessing).mockImplementation(async (key) =>
    key.startsWith('111')
      ? {
          status: 'ready',
          url: videoUrl,
          thumbnailUrl: videoUrl.replace('.mp4', '-thumbnail.jpg'),
          kind: 'video',
        }
      : {
          status: 'ready',
          url: photoUrl,
          thumbnailUrl: photoUrl.replace('.jpg', '-thumbnail.jpg'),
          kind: 'livePhoto',
          videoUrl: motionUrl,
        }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  )
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const { container, unmount } = renderWithQueryClient(
    <PhotosPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
  )
  await screen.findByRole('button', { name: 'Play Live Photo' })
  await waitFor(() =>
    expect(container.querySelector('.media-video-preview img')).toHaveAttribute(
      'src',
      `http://localhost:3000${videoUrl.replace('.mp4', '-thumbnail.jpg')}`
    )
  )
  expect(container.querySelector('.live-photo video')).not.toHaveAttribute('src')
  expect(play).not.toHaveBeenCalled()
  await userEvent.click(screen.getAllByRole('button', { name: 'Open photo' })[1])
  const lightbox = container.querySelector<HTMLElement>('.lightbox')!
  await within(lightbox).findByRole('button', { name: 'Pause Live Photo' })
  await waitFor(() =>
    expect(lightbox.querySelector('video')).toHaveAttribute('src', `http://localhost:3000${motionUrl}`)
  )
  expect(play).toHaveBeenCalled()
  unmount()
  play.mockRestore()
  pause.mockRestore()
  vi.unstubAllGlobals()
})
