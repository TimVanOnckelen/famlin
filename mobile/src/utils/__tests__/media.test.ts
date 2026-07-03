import { isVideoUrl } from '@/utils/media';

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
