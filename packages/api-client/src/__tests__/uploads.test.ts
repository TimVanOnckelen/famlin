// uploads.ts tracks mediaTokenFetchedAt as module-level state, so each test
// re-imports a fresh instance (vi.resetModules()) to avoid state leaking
// between cases — see the same pattern in __tests__/client.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../client', () => ({
  api: { get: vi.fn() },
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
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue(null);
      (client.getCurrentMediaToken as any).mockReturnValue('some-token');

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    });

    it('returns "<server><path>?token=<token>" when a server URL and media token are set', async () => {
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg?token=tok123');
    });

    it('omits the query string when there is a server URL but no media token yet', async () => {
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue(null);

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg');
    });

    it('rewrites to a -thumbnail.jpg sibling when variant is "thumbnail" and the extension is a convertible image type', async () => {
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.jpg', 'thumbnail')).toBe(
        'http://example.com/uploads/abc-thumbnail.jpg?token=tok123'
      );
      expect(getUploadUrl('/uploads/abc.HEIC', 'thumbnail')).toBe(
        'http://example.com/uploads/abc-thumbnail.jpg?token=tok123'
      );
    });

    it('leaves gif and video paths unchanged even when variant is "thumbnail"', async () => {
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.gif', 'thumbnail')).toBe('http://example.com/uploads/abc.gif?token=tok123');
      expect(getUploadUrl('/uploads/abc.mp4', 'thumbnail')).toBe('http://example.com/uploads/abc.mp4?token=tok123');
    });

    it('returns the plain path when no variant is passed, unchanged from before', async () => {
      const client = await import('../client');
      (client.getCurrentServerUrl as any).mockReturnValue('http://example.com');
      (client.getCurrentMediaToken as any).mockReturnValue('tok123');

      const { getUploadUrl } = await import('../uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg?token=tok123');
    });
  });

  describe('refreshMediaToken', () => {
    it('retries once on failure and succeeds, without ever nulling the token', async () => {
      const client = await import('../client');
      (client.api.get as any).mockRejectedValueOnce(new Error('network fail')).mockResolvedValueOnce({
        data: { token: 'recovered-token' },
      });

      const { refreshMediaToken } = await import('../uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      expect(client.setMediaToken).toHaveBeenCalledWith('recovered-token');
      expect(client.setMediaToken).not.toHaveBeenCalledWith(null);
    });

    it('sets the token to null only after both attempts fail', async () => {
      const client = await import('../client');
      (client.api.get as any).mockRejectedValue(new Error('network fail'));

      const { refreshMediaToken } = await import('../uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      expect(client.setMediaToken).toHaveBeenLastCalledWith(null);
    });

    it('succeeds on the first attempt without a second call', async () => {
      const client = await import('../client');
      (client.api.get as any).mockResolvedValueOnce({ data: { token: 'first-try-token' } });

      const { refreshMediaToken } = await import('../uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(1);
      expect(client.setMediaToken).toHaveBeenCalledWith('first-try-token');
    });
  });

  describe('ensureFreshMediaToken', () => {
    it('refetches when there is no media token yet, even if just fetched', async () => {
      const client = await import('../client');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads');

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

      const client = await import('../client');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      (client.getCurrentMediaToken as any).mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads');

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

      const client = await import('../client');
      (client.api.get as any).mockResolvedValue({ data: { token: 'a' } });
      (client.getCurrentMediaToken as any).mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = await import('../uploads');

      await refreshMediaToken();
      (client.api.get as any).mockClear();

      vi.setSystemTime(new Date(start.getTime() + 60 * 60 * 1000)); // 1h later, still fresh
      await ensureFreshMediaToken();

      expect(client.api.get).not.toHaveBeenCalled();
    });
  });
});
