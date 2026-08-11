import { prepareForUpload } from '@/utils/prepareUpload';

// `mock`-prefixed so jest.mock's factory may reference them despite hoisting.
const mockRenderAsync = jest.fn();
const mockResize = jest.fn(() => ({ renderAsync: mockRenderAsync }));
const mockManipulate = jest.fn(() => ({ resize: mockResize, release: jest.fn() }));

jest.mock('expo-image-manipulator', () => ({
  // Indirected through an arrow so the reference resolves at call time: the
  // factory itself runs during module hoisting, before the consts above are
  // initialised.
  ImageManipulator: { manipulate: (...args: any[]) => mockManipulate(...(args as [])) },
  SaveFormat: { JPEG: 'jpeg' },
}));

function rendered(uri: string) {
  return { saveAsync: jest.fn(async () => ({ uri, width: 2048, height: 1536 })), release: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderAsync.mockImplementation(async () => rendered('file:///resized.jpg'));
});

describe('prepareForUpload', () => {
  it('downscales an oversized photo and renames it to .jpg', async () => {
    const [result] = await prepareForUpload([
      { uri: 'file:///huge.heic', name: 'huge.heic', type: 'image/heic', width: 4032, height: 3024 },
    ]);

    // 4032 -> 2048 on the long edge, aspect ratio preserved.
    expect(mockResize).toHaveBeenCalledWith({ width: 2048, height: 1536 });
    expect(result).toEqual({ uri: 'file:///resized.jpg', name: 'huge.jpg', type: 'image/jpeg' });
  });

  it('leaves videos alone', async () => {
    const video = { uri: 'file:///clip.mp4', name: 'clip.mp4', type: 'video/mp4', width: 3840, height: 2160 };
    const [result] = await prepareForUpload([video]);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: video.uri, name: video.name, type: video.type });
  });

  it('leaves gifs alone so animation survives', async () => {
    const gif = { uri: 'file:///loop.gif', name: 'loop.gif', type: 'image/gif', width: 4000, height: 4000 };
    const [result] = await prepareForUpload([gif]);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: gif.uri, name: gif.name, type: gif.type });
  });

  it('leaves an already-small, already-light photo alone', async () => {
    const small = {
      uri: 'file:///small.jpg',
      name: 'small.jpg',
      type: 'image/jpeg',
      width: 1200,
      height: 900,
      fileSize: 300_000,
    };
    const [result] = await prepareForUpload([small]);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: small.uri, name: small.name, type: small.type });
  });

  it('re-encodes a within-bounds photo that is still a heavy file', async () => {
    await prepareForUpload([
      {
        uri: 'file:///heavy.heic',
        name: 'heavy.heic',
        type: 'image/heic',
        width: 2000,
        height: 1500,
        fileSize: 4_000_000,
      },
    ]);

    // No upscaling — the long edge is already under the cap, so the scale
    // factor is clamped to 1 and only the re-encode buys anything.
    expect(mockResize).toHaveBeenCalledWith({ width: 2000, height: 1500 });
  });

  it('skips downscaling when the picker reported no dimensions', async () => {
    const unknown = { uri: 'file:///unknown.jpg', name: 'unknown.jpg', type: 'image/jpeg' };
    const [result] = await prepareForUpload([unknown]);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toEqual(unknown);
  });

  it('falls back to the original file when the manipulator throws', async () => {
    // The realistic failure on an older Android device: not enough heap to
    // decode a 12MP bitmap. Must degrade to a full-size upload, never a
    // dropped photo.
    mockRenderAsync.mockRejectedValueOnce(new Error('OutOfMemoryError'));

    const original = { uri: 'file:///huge.jpg', name: 'huge.jpg', type: 'image/jpeg', width: 4032, height: 3024 };
    const [result] = await prepareForUpload([original]);

    expect(result).toEqual({ uri: original.uri, name: original.name, type: original.type });
  });

  it('processes files one at a time so only one bitmap is ever live', async () => {
    let concurrent = 0;
    let peak = 0;
    mockRenderAsync.mockImplementation(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
      concurrent -= 1;
      return rendered('file:///resized.jpg');
    });

    await prepareForUpload(
      Array.from({ length: 5 }, (_, i) => ({
        uri: `file:///p${i}.jpg`,
        name: `p${i}.jpg`,
        type: 'image/jpeg',
        width: 4032,
        height: 3024,
      }))
    );

    expect(peak).toBe(1);
  });
});
