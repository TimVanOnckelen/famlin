import { setApiBaseUrl, setMediaToken } from '@famlin/api-client'
import { isVideoUrl, getVideoPosterUrl, mediaTileProps } from '@/utils/media'

describe('isVideoUrl', () => {
  it.each([
    ['/uploads/clip.mp4', true],
    ['/uploads/clip.mov', true],
    ['/uploads/clip.m4v', true],
    ['/uploads/clip.webm', true],
    ['/uploads/photo.jpg', false],
    ['/uploads/photo.png', false],
    ['/uploads/noextension', false],
  ])('%s -> %s', (url, expected) => {
    expect(isVideoUrl(url)).toBe(expected)
  })

  it('handles a query string after the extension', () => {
    expect(isVideoUrl('/uploads/clip.mp4?token=abc123')).toBe(true)
    expect(isVideoUrl('/uploads/photo.jpg?token=abc123')).toBe(false)
  })

  it('is case-insensitive on the extension', () => {
    expect(isVideoUrl('/uploads/CLIP.MP4')).toBe(true)
    expect(isVideoUrl('/uploads/Clip.MOV?token=X')).toBe(true)
  })

  it('does not match an extension-like substring that is not at the end of the path', () => {
    expect(isVideoUrl('/uploads/clip.mp4.jpg')).toBe(false)
  })
})

describe('getVideoPosterUrl', () => {
  it('maps a direct upload to its -thumbnail.jpg poster, keeping the query string', () => {
    expect(getVideoPosterUrl('https://s.example/uploads/abc.mp4?token=x')).toBe(
      'https://s.example/uploads/abc-thumbnail.jpg?token=x'
    )
    expect(getVideoPosterUrl('/uploads/abc.mov')).toBe('/uploads/abc-thumbnail.jpg')
  })

  it('maps a media-proxy original to the thumbnail rendition', () => {
    expect(getVideoPosterUrl('https://s.example/api/media/assets/link1/asset2/original.mp4?token=x')).toBe(
      'https://s.example/api/media/assets/link1/asset2/thumbnail.jpg?token=x'
    )
  })

  it('maps a legacy immich-proxy original to the thumbnail rendition', () => {
    expect(getVideoPosterUrl('/api/immich/assets/link1/asset2/original.webm')).toBe(
      '/api/immich/assets/link1/asset2/thumbnail.jpg'
    )
  })

  it('returns null for non-video URLs', () => {
    expect(getVideoPosterUrl('/uploads/photo.jpg?token=x')).toBeNull()
  })

  it('returns null for local picker URIs, which have no server-side poster', () => {
    expect(getVideoPosterUrl('file:///data/user/0/app/cache/picker/clip.mp4')).toBeNull()
  })
})

describe('mediaTileProps', () => {
  beforeAll(() => {
    setApiBaseUrl('https://s.example')
    setMediaToken('tok')
  })

  it('loads the thumbnail variant for a photo, with the display copy as fallback', () => {
    expect(mediaTileProps('/uploads/abc.jpg')).toEqual({
      url: 'https://s.example/uploads/abc-thumbnail.jpg?token=tok',
      fallbackUrl: 'https://s.example/uploads/abc.jpg?token=tok',
    })
  })

  it('keeps the plain URL for a video — MediaThumbnail already loads only its poster frame', () => {
    expect(mediaTileProps('/uploads/clip.mp4')).toEqual({
      url: 'https://s.example/uploads/clip.mp4?token=tok',
    })
  })

  it('swaps the rendition segment for a media-proxy photo', () => {
    expect(mediaTileProps('/api/media/assets/link1/asset2/preview.jpg')).toEqual({
      url: 'https://s.example/api/media/assets/link1/asset2/thumbnail.jpg?token=tok',
      fallbackUrl: 'https://s.example/api/media/assets/link1/asset2/preview.jpg?token=tok',
    })
  })

  it('leaves an unrecognized shape alone (thumbnail URL equals the fallback)', () => {
    const tile = mediaTileProps('/somewhere/else/photo.jpg')
    expect(tile.url).toBe('https://s.example/somewhere/else/photo.jpg?token=tok')
    expect(tile.fallbackUrl).toBe(tile.url)
  })
})
