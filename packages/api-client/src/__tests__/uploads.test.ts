// uploads.ts tracks mediaTokenFetchedAt as module-level state, so each test
// re-imports a fresh instance (vi.resetModules()) to avoid state leaking
// between cases — see the same pattern in __tests__/client.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getCurrentServerUrl: vi.fn(),
  getCurrentMediaToken: vi.fn(),
  setMediaToken: vi.fn(),
}));

describe('uploads', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    // Unlike jest's automock factories, vi.mock's mocked module instance
    // (and its call history) persists across vi.resetModules() — clear call
    // counts/queued implementations explicitly so each test starts fresh.
    vi.clearAllMocks();
  });

  describe('getUploadUrl', () => {
    it('returns the raw path when no server URL is set', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue(null);
      (client.getCurrentMediaToken as any).mockReturnValue('some-token');

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    });

    it('returns "<server><path>?token=<token>" when a server URL and media token are set', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg?token=tok123');
    });

    it('omits the query string when there is a server URL but no media token yet', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue(null);

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg');
    });

    it('rewrites to a -thumbnail.jpg sibling when variant is "thumbnail" and the extension is a convertible image type', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.jpg', 'thumbnail')).toBe(
        'http://example.com/uploads/abc-thumbnail.jpg?token=tok123'
      );
      expect(getUploadUrl('/uploads/abc.HEIC', 'thumbnail')).toBe(
        'http://example.com/uploads/abc-thumbnail.jpg?token=tok123'
      );
    });

    it('leaves GIF unchanged and derives video poster URLs for thumbnails', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.gif', 'thumbnail')).toBe('http://example.com/uploads/abc.gif?token=tok123');
      expect(getUploadUrl('/uploads/abc.mp4', 'thumbnail')).toBe('http://example.com/uploads/abc-thumbnail.jpg?token=tok123');
    });

    it('returns the plain path when no variant is passed, unchanged from before', async () => {
      const client = await import('../client.js');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads.js');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg?token=tok123');
    });
  });

  describe('uploadFiles', () => {
    it('reports transmitted bytes and waits for a known total', async () => {
      const client = await import('../client.js');
      (client.api.post as any).mockResolvedValue({ data: { urls: ['/uploads/a.jpg'] } });
      const { uploadFiles } = await import('../uploads.js');
      const progress = vi.fn();
      await uploadFiles([new File(['a'], 'a.jpg')], progress);
      const config = (client.api.post as any).mock.calls[0][2];
      config.onUploadProgress({ loaded: 5 });
      expect(progress).not.toHaveBeenCalled();
      config.onUploadProgress({ loaded: 5, total: 10 });
      expect(progress).toHaveBeenLastCalledWith(0.5);
      config.onUploadProgress({ loaded: 11, total: 10 });
      expect(progress).toHaveBeenLastCalledWith(1);
    });

    it('posts the batch as multipart, clearing the JSON content type', async () => {
      const client = await import('../client.js');
      (client.api.post as any).mockResolvedValue({ data: { urls: ['/uploads/a.jpg', '/uploads/b.jpg'] } });

      const { uploadFiles, UPLOAD_TIMEOUT_MS } = await import('../uploads.js');
      const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')];
      const urls = await uploadFiles(files as any);

      expect(urls).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
      const [path, body, config] = (client.api.post as any).mock.calls[0];
      expect(path).toBe('/uploads');
      // The whole batch goes in one request, and every part is named "file"
      // (the route walks every file part regardless of field name).
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).getAll('file')).toHaveLength(2);
      // Leaving the client's default application/json in place makes axios
      // serialize the FormData to JSON ({"file":{}}) and the route answers
      // 406 "the request is not multipart" — the bytes never leave at all.
      expect(config.headers['Content-Type']).toBeUndefined();
      expect('Content-Type' in config.headers).toBe(true);
      // A photo/video upload must not be held to the JSON-API timeout.
      expect(config.timeout).toBe(UPLOAD_TIMEOUT_MS);
      expect(UPLOAD_TIMEOUT_MS).toBeGreaterThan(60_000);
    });
  });

  describe('uploadFilesInSession', () => {
    it('sends draft context to upload and preserves its normalized media response', async () => {
      const client = await import('../client.js');
      const response = { urls: ['/uploads/video.mp4'], sessionMedia: [{ url: '/uploads/photo.jpg', videoUrl: '/uploads/video.mp4', kind: 'livePhoto', status: 'queued', thumbnailUrl: '/uploads/photo-thumbnail.jpg' }] };
      (client.api.post as any).mockResolvedValue({ data: response });
      const { uploadFilesInSession } = await import('../uploads.js');
      expect(await uploadFilesInSession([new File(['v'], 'IMG_1234.MOV')], 'draft-id', ['removed-id'])).toEqual(response);
      const [route, body, config] = (client.api.post as any).mock.calls[0];
      expect(route).toBe('/uploads');
      expect(body.getAll('file')).toHaveLength(1);
      expect(config.headers['X-Upload-Session-Id']).toBe('draft-id');
      expect(JSON.parse(config.headers['X-Upload-Session-Exclude'])).toEqual(['removed-id']);
    });
  });

  describe('refreshMediaToken', () => {
    it('retries once on failure and succeeds, without ever nulling the token', async () => {
      const client = await import('../client.js');
      (client.api.get as any).mockRejectedValueOnce(new Error('network fail')).mockResolvedValueOnce({
        data: { token: 'recovered-token' },
      });

      const { refreshMediaToken } = await import('../uploads.js');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      expect(client.setMediaToken).toHaveBeenCalledWith('recovered-token');
      expect(client.setMediaToken).not.toHaveBeenCalledWith(null);
    });

    it('keeps the cached token when both attempts fail', async () => {
      const client = await import('../client.js');
      (client.api.get as any).mockRejectedValue(new Error('network fail'));

      const { refreshMediaToken } = await import('../uploads.js');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      // Dropping the existing token would 401 every /uploads GET with no
      // retry path; a possibly-stale token is strictly better than none.
      expect(client.setMediaToken).not.toHaveBeenCalled();
    });

    it('marks the token stale after a failed refresh so the next foreground retries', async () => {
      const client = await import('../client.js');
      (client.api.get as any).mockRejectedValue(new Error('network fail'));

      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads.js');
      await refreshMediaToken();
      (client.api.get as any).mockClear();
      (client.getCurrentMediaToken as any).mockReturnValue('stale-token');

      await ensureFreshMediaToken();

      expect(client.api.get).toHaveBeenCalled();
    });

    it('succeeds on the first attempt without a second call', async () => {
      const client = await import('../client.js');
      (client.api.get as any).mockResolvedValueOnce({ data: { token: 'first-try-token' } });

      const { refreshMediaToken } = await import('../uploads.js');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(1);
      expect(client.setMediaToken).toHaveBeenCalledWith('first-try-token');
    });
  });

  describe('ensureFreshMediaToken', () => {
    it('refetches when there is no media token yet, even if just fetched', async () => {
      const client = await import('../client.js');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads.js');

      await refreshMediaToken(); // marks fetchedAt as "now" (fresh)
      (client.getCurrentMediaToken as any).mockReturnValue(null); // but no token is actually present
      (client.api.get as any).mockClear();

      await ensureFreshMediaToken();
      expect(client.api.get).toHaveBeenCalledTimes(1);
    });

    it('refetches when the token is older than 24h', async () => {
      vi.useFakeTimers();
      const start = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(start);

      const client = await import('../client.js');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      (client.getCurrentMediaToken as any).mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads.js');

      await refreshMediaToken();
      (client.api.get as any).mockClear();

      vi.setSystemTime(new Date(start.getTime() + 25 * 60 * 60 * 1000));
      await ensureFreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(1);
    });

    it('skips refetching when the token is present and fresh', async () => {
      vi.useFakeTimers();
      const start = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(start);

      const client = await import('../client.js');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      (client.getCurrentMediaToken as any).mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads.js');

      await refreshMediaToken();
      (client.api.get as any).mockClear();

      vi.setSystemTime(new Date(start.getTime() + 60 * 60 * 1000)); // 1h later, still fresh
      await ensureFreshMediaToken();

      expect(client.api.get).not.toHaveBeenCalled();
    });
  });
});
