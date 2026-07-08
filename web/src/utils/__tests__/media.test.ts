import { isVideoUrl } from '@/utils/media';

describe('isVideoUrl', () => {
  it('detects video extensions in upload paths', () => {
    expect(isVideoUrl('/uploads/abc.mp4')).toBe(true);
    expect(isVideoUrl('/uploads/abc.MOV')).toBe(true);
    expect(isVideoUrl('/uploads/abc.webm')).toBe(true);
  });

  it('detects video extensions in Immich proxy paths with a token query', () => {
    expect(isVideoUrl('/api/immich/assets/link1/asset1/original.mp4?token=x')).toBe(true);
    expect(isVideoUrl('/api/immich/assets/link1/asset1/thumbnail.jpg?token=x')).toBe(false);
  });

  it('treats images as non-video', () => {
    expect(isVideoUrl('/uploads/abc.jpg')).toBe(false);
    expect(isVideoUrl('/uploads/abc.heic')).toBe(false);
  });
});
