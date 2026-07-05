// uploads.ts tracks mediaTokenFetchedAt as module-level state, so each test
// re-requires a fresh instance (jest.resetModules()) to avoid state leaking
// between cases — see the same pattern in api/__tests__/client.test.ts.

jest.mock('@/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getCurrentServerUrl: jest.fn(),
  getCurrentMediaToken: jest.fn(),
  setMediaToken: jest.fn(),
}));

describe('api/uploads', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useRealTimers();
  });

  describe('getUploadUrl', () => {
    it('returns the raw path when no server URL is set', () => {
      const client = require('@/api/client');
      client.getCurrentServerUrl.mockReturnValue(null);
      client.getCurrentMediaToken.mockReturnValue('some-token');

      const { getUploadUrl } = require('@/api/uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    });

    it('returns "<server><path>?token=<token>" when a server URL and media token are set', () => {
      const client = require('@/api/client');
      client.getCurrentServerUrl.mockReturnValue('http://example.com');
      client.getCurrentMediaToken.mockReturnValue('tok123');

      const { getUploadUrl } = require('@/api/uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg?token=tok123');
    });

    it('omits the query string when there is a server URL but no media token yet', () => {
      const client = require('@/api/client');
      client.getCurrentServerUrl.mockReturnValue('http://example.com');
      client.getCurrentMediaToken.mockReturnValue(null);

      const { getUploadUrl } = require('@/api/uploads');
      expect(getUploadUrl('/uploads/abc.jpg')).toBe('http://example.com/uploads/abc.jpg');
    });
  });

  describe('refreshMediaToken', () => {
    it('retries once on failure and succeeds, without ever nulling the token', async () => {
      const client = require('@/api/client');
      client.api.get.mockRejectedValueOnce(new Error('network fail')).mockResolvedValueOnce({
        data: { token: 'recovered-token' },
      });

      const { refreshMediaToken } = require('@/api/uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      expect(client.setMediaToken).toHaveBeenCalledWith('recovered-token');
      expect(client.setMediaToken).not.toHaveBeenCalledWith(null);
    });

    it('sets the token to null only after both attempts fail', async () => {
      const client = require('@/api/client');
      client.api.get.mockRejectedValue(new Error('network fail'));

      const { refreshMediaToken } = require('@/api/uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(2);
      expect(client.setMediaToken).toHaveBeenLastCalledWith(null);
    });

    it('succeeds on the first attempt without a second call', async () => {
      const client = require('@/api/client');
      client.api.get.mockResolvedValueOnce({ data: { token: 'first-try-token' } });

      const { refreshMediaToken } = require('@/api/uploads');
      await refreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(1);
      expect(client.setMediaToken).toHaveBeenCalledWith('first-try-token');
    });
  });

  describe('ensureFreshMediaToken', () => {
    it('refetches when there is no media token yet, even if just fetched', async () => {
      const client = require('@/api/client');
      client.api.get.mockResolvedValue({ data: { token: 'a' } });
      const { refreshMediaToken, ensureFreshMediaToken } = require('@/api/uploads');

      await refreshMediaToken(); // marks fetchedAt as "now" (fresh)
      client.getCurrentMediaToken.mockReturnValue(null); // but no token is actually present
      client.api.get.mockClear();

      await ensureFreshMediaToken();
      expect(client.api.get).toHaveBeenCalledTimes(1);
    });

    it('refetches when the token is older than 24h', async () => {
      jest.useFakeTimers();
      const start = new Date('2024-01-01T00:00:00Z');
      jest.setSystemTime(start);

      const client = require('@/api/client');
      client.api.get.mockResolvedValue({ data: { token: 'a' } });
      client.getCurrentMediaToken.mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = require('@/api/uploads');

      await refreshMediaToken();
      client.api.get.mockClear();

      jest.setSystemTime(new Date(start.getTime() + 25 * 60 * 60 * 1000));
      await ensureFreshMediaToken();

      expect(client.api.get).toHaveBeenCalledTimes(1);
    });

    it('skips refetching when the token is present and fresh', async () => {
      jest.useFakeTimers();
      const start = new Date('2024-01-01T00:00:00Z');
      jest.setSystemTime(start);

      const client = require('@/api/client');
      client.api.get.mockResolvedValue({ data: { token: 'a' } });
      client.getCurrentMediaToken.mockReturnValue('a');
      const { refreshMediaToken, ensureFreshMediaToken } = require('@/api/uploads');

      await refreshMediaToken();
      client.api.get.mockClear();

      jest.setSystemTime(new Date(start.getTime() + 60 * 60 * 1000)); // 1h later, still fresh
      await ensureFreshMediaToken();

      expect(client.api.get).not.toHaveBeenCalled();
    });
  });

  describe('uploadMedia', () => {
    it('passes timeout: 0 so large uploads do not time out on remote servers', async () => {
      const client = require('@/api/client');
      client.api.post.mockResolvedValueOnce({ data: { urls: ['/uploads/abc.jpg'] } });

      const { uploadMedia } = require('@/api/uploads');
      const urls = await uploadMedia([{ uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }]);

      expect(urls).toEqual(['/uploads/abc.jpg']);
      const [, , config] = client.api.post.mock.calls[0];
      expect(config.timeout).toBe(0);
    });
  });
});
