// client.ts keeps its base URL and media token as module-level singletons,
// and storage.ts keeps the registered adapter as a module-level singleton
// too — so each test needs a fresh instance of both (vi.resetModules() +
// dynamic import) and must re-register the fake adapter after every reset.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StorageAdapter } from '../storage';

describe('client', () => {
  let fakeAdapter: {
    getItem: ReturnType<typeof vi.fn<StorageAdapter['getItem']>>;
    setItem: ReturnType<typeof vi.fn<StorageAdapter['setItem']>>;
    removeItem: ReturnType<typeof vi.fn<StorageAdapter['removeItem']>>;
  };

  beforeEach(async () => {
    vi.resetModules();
    fakeAdapter = {
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    };
    const { setStorageAdapter } = await import('../storage');
    setStorageAdapter(fakeAdapter);
  });

  it('has no server URL until setApiBaseUrl/initApiBaseUrl has run', async () => {
    const { getCurrentServerUrl } = await import('../client');
    expect(getCurrentServerUrl()).toBeNull();
  });

  it('setApiBaseUrl normalizes a trailing slash and getCurrentServerUrl reflects it', async () => {
    const { setApiBaseUrl, getCurrentServerUrl } = await import('../client');
    setApiBaseUrl('http://example.com/');
    expect(getCurrentServerUrl()).toBe('http://example.com');
  });

  it('setApiBaseUrl strips repeated trailing slashes, not just one', async () => {
    const { setApiBaseUrl, getCurrentServerUrl } = await import('../client');
    setApiBaseUrl('http://example.com//');
    expect(getCurrentServerUrl()).toBe('http://example.com');
  });

  it('setApiBaseUrl trims whitespace', async () => {
    const { setApiBaseUrl, getCurrentServerUrl } = await import('../client');
    setApiBaseUrl('  http://example.com  ');
    expect(getCurrentServerUrl()).toBe('http://example.com');
  });

  it('on a 401, the response interceptor removes the token and calls the unauthorized handler', async () => {
    const { api, setUnauthorizedHandler } = await import('../client');

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    const rejectedInterceptor = (api.interceptors.response as any).handlers[0].rejected;
    const fakeError = { response: { status: 401 }, config: { headers: { Authorization: 'Bearer t' } } };

    await expect(rejectedInterceptor(fakeError)).rejects.toBe(fakeError);

    expect(fakeAdapter.removeItem).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('on a non-401 error, neither removeItem nor the unauthorized handler is called', async () => {
    const { api, setUnauthorizedHandler } = await import('../client');

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    const rejectedInterceptor = (api.interceptors.response as any).handlers[0].rejected;
    const fakeError = { response: { status: 500 } };

    await expect(rejectedInterceptor(fakeError)).rejects.toBe(fakeError);

    expect(fakeAdapter.removeItem).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  describe('session token scoping', () => {
    async function requestHeaders(storage: Record<string, string>, currentServer: string) {
      fakeAdapter.getItem.mockImplementation(async (key: string) => storage[key] ?? null);
      const { api, setApiBaseUrl } = await import('../client');
      setApiBaseUrl(currentServer);
      const fulfilled = (api.interceptors.request as any).handlers[0].fulfilled;
      const config = await fulfilled({ headers: {} });
      return config.headers;
    }

    it('attaches the token when talking to the server it was stored with', async () => {
      const headers = await requestHeaders(
        { famlin_token: 'tok', famlin_server_url: 'https://family.example/' },
        'https://family.example'
      );
      expect(headers.Authorization).toBe('Bearer tok');
    });

    it('withholds the token from any other server (e.g. one named by an invite link)', async () => {
      const headers = await requestHeaders(
        { famlin_token: 'tok', famlin_server_url: 'https://family.example' },
        'https://attacker.example'
      );
      expect(headers.Authorization).toBeUndefined();
    });

    it('attaches the token when no server URL is stored (web/admin use their own origin)', async () => {
      const headers = await requestHeaders({ famlin_token: 'tok' }, 'https://family.example');
      expect(headers.Authorization).toBe('Bearer tok');
    });
  });

  it('ignores a 401 for a request that did not carry the session token', async () => {
    const { api, setUnauthorizedHandler } = await import('../client');

    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    const rejectedInterceptor = (api.interceptors.response as any).handlers[0].rejected;
    const fakeError = { response: { status: 401 }, config: { headers: {} } };

    await expect(rejectedInterceptor(fakeError)).rejects.toBe(fakeError);

    expect(fakeAdapter.removeItem).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
