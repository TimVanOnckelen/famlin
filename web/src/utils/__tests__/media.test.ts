import { fileFormatLabel, isBrowserDecodableImage, isVideoUrl } from '@/utils/media';

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

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('isBrowserDecodableImage', () => {
  it('rejects HEIC/HEIF by mime type', () => {
    expect(isBrowserDecodableImage(file('IMG_0001', 'image/heic'))).toBe(false);
    expect(isBrowserDecodableImage(file('IMG_0001', 'image/HEIF'))).toBe(false);
  });

  it('rejects HEIC/HEIF by filename when the browser reports no type', () => {
    expect(isBrowserDecodableImage(file('IMG_0001.HEIC', ''))).toBe(false);
    expect(isBrowserDecodableImage(file('IMG_0001.heif', ''))).toBe(false);
  });

  it('accepts formats every browser can render', () => {
    expect(isBrowserDecodableImage(file('photo.jpg', 'image/jpeg'))).toBe(true);
    expect(isBrowserDecodableImage(file('photo.png', 'image/png'))).toBe(true);
    expect(isBrowserDecodableImage(file('sticker.gif', 'image/gif'))).toBe(true);
  });
});

describe('fileFormatLabel', () => {
  it('uppercases the extension', () => {
    expect(fileFormatLabel(file('IMG_0001.heic', 'image/heic'))).toBe('HEIC');
  });

  it('falls back to a generic label for an extensionless file', () => {
    expect(fileFormatLabel(file('IMG_0001', 'image/heic'))).toBe('IMG');
  });
});
