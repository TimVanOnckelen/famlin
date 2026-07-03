// api/client.ts keeps its base URL and media token as module-level
// singletons initialized once at import time (from EXPO_PUBLIC_API_URL), so
// each test needs a fresh module instance — jest.resetModules() + require()
// (rather than a static top-level import) is what makes that possible here.

jest.mock('@/utils/storage', () => ({
  getToken: jest.fn().mockResolvedValue(null),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  getServerUrl: jest.fn().mockResolvedValue(null),
}));

describe('api/client', () => {
  const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  afterAll(() => {
    if (ORIGINAL_ENV !== undefined) process.env.EXPO_PUBLIC_API_URL = ORIGINAL_ENV;
  });

  it('has no server URL (no localhost fallback) when EXPO_PUBLIC_API_URL is unset', () => {
    const { getCurrentServerUrl } = require('@/api/client');
    expect(getCurrentServerUrl()).toBeNull();
  });

  it('setApiBaseUrl normalizes a trailing slash and getCurrentServerUrl reflects it', () => {
    const { setApiBaseUrl, getCurrentServerUrl } = require('@/api/client');
    setApiBaseUrl('http://example.com/');
    expect(getCurrentServerUrl()).toBe('http://example.com');
  });

  it('setApiBaseUrl trims whitespace', () => {
    const { setApiBaseUrl, getCurrentServerUrl } = require('@/api/client');
    setApiBaseUrl('  http://example.com  ');
    expect(getCurrentServerUrl()).toBe('http://example.com');
  });

  it('on a 401, the response interceptor deletes the token and calls the unauthorized handler', async () => {
    const storage = require('@/utils/storage');
    const { api, setUnauthorizedHandler } = require('@/api/client');

    const handler = jest.fn();
    setUnauthorizedHandler(handler);

    const rejectedInterceptor = (api.interceptors.response as any).handlers[0].rejected;
    const fakeError = { response: { status: 401 } };

    await expect(rejectedInterceptor(fakeError)).rejects.toBe(fakeError);

    expect(storage.deleteToken).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('on a non-401 error, neither deleteToken nor the unauthorized handler is called', async () => {
    const storage = require('@/utils/storage');
    const { api, setUnauthorizedHandler } = require('@/api/client');

    const handler = jest.fn();
    setUnauthorizedHandler(handler);

    const rejectedInterceptor = (api.interceptors.response as any).handlers[0].rejected;
    const fakeError = { response: { status: 500 } };

    await expect(rejectedInterceptor(fakeError)).rejects.toBe(fakeError);

    expect(storage.deleteToken).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
