import { isVideoUrl, getVideoPosterUrl } from '@/utils/media';

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
    expect(isVideoUrl(url)).toBe(expected);
  });

  it('handles a query string after the extension', () => {
    expect(isVideoUrl('/uploads/clip.mp4?token=abc123')).toBe(true);
    expect(isVideoUrl('/uploads/photo.jpg?token=abc123')).toBe(false);
  });

  it('is case-insensitive on the extension', () => {
    expect(isVideoUrl('/uploads/CLIP.MP4')).toBe(true);
    expect(isVideoUrl('/uploads/Clip.MOV?token=X')).toBe(true);
  });

  it('does not match an extension-like substring that is not at the end of the path', () => {
    expect(isVideoUrl('/uploads/clip.mp4.jpg')).toBe(false);
  });
});

describe('getVideoPosterUrl', () => {
  it('maps a direct upload to its -thumbnail.jpg poster, keeping the query string', () => {
    expect(getVideoPosterUrl('https://s.example/uploads/abc.mp4?token=x')).toBe(
      'https://s.example/uploads/abc-thumbnail.jpg?token=x'
    );
    expect(getVideoPosterUrl('/uploads/abc.mov')).toBe('/uploads/abc-thumbnail.jpg');
  });

  it('maps a media-proxy original to the thumbnail rendition', () => {
    expect(
      getVideoPosterUrl('https://s.example/api/media/assets/link1/asset2/original.mp4?token=x')
    ).toBe('https://s.example/api/media/assets/link1/asset2/thumbnail.jpg?token=x');
  });

  it('maps a legacy immich-proxy original to the thumbnail rendition', () => {
    expect(getVideoPosterUrl('/api/immich/assets/link1/asset2/original.webm')).toBe(
      '/api/immich/assets/link1/asset2/thumbnail.jpg'
    );
  });

  it('returns null for non-video URLs', () => {
    expect(getVideoPosterUrl('/uploads/photo.jpg?token=x')).toBeNull();
  });

  it('returns null for local picker URIs, which have no server-side poster', () => {
    expect(getVideoPosterUrl('file:///data/user/0/app/cache/picker/clip.mp4')).toBeNull();
  });
});
