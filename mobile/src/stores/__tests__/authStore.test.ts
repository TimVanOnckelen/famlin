import { User } from '@/types';

jest.mock('@/utils/storage', () => ({
  setToken: jest.fn().mockResolvedValue(undefined),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue(null),
  setServerUrl: jest.fn().mockResolvedValue(undefined),
  deleteServerUrl: jest.fn().mockResolvedValue(undefined),
  getPushToken: jest.fn().mockResolvedValue(null),
  deletePushToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/uploads', () => ({
  refreshMediaToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/client', () => ({
  api: { delete: jest.fn().mockResolvedValue(undefined) },
  setApiBaseUrl: jest.fn(),
  setMediaToken: jest.fn(),
}));

const testUser: User = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  isAdmin: false,
  emailOnNewPost: true,
  emailOnNewComment: true,
  emailOnNewLike: true,
  pushOnNewPost: true,
  pushOnNewComment: true,
  pushOnNewLike: true,
};

describe('authStore', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('setAuth stores the token/server, sets the api base URL, updates state, and refreshes the media token', async () => {
    const storage = require('@/utils/storage');
    const client = require('@/api/client');
    const uploads = require('@/api/uploads');
    const { useAuthStore } = require('@/stores/authStore');

    await useAuthStore.getState().setAuth(testUser, 'tok-abc', 'http://example.com');

    expect(storage.setToken).toHaveBeenCalledWith('tok-abc');
    expect(storage.setServerUrl).toHaveBeenCalledWith('http://example.com');
    expect(client.setApiBaseUrl).toHaveBeenCalledWith('http://example.com');
    expect(uploads.refreshMediaToken).toHaveBeenCalledTimes(1);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(testUser);
    expect(state.token).toBe('tok-abc');
    expect(state.serverUrl).toBe('http://example.com');
    expect(state.isLoading).toBe(false);
  });

  it('logout deletes the token AND the server URL and resets state', async () => {
    const storage = require('@/utils/storage');
    const client = require('@/api/client');
    storage.getPushToken.mockResolvedValue(null); // no push token registered
    const { useAuthStore } = require('@/stores/authStore');

    await useAuthStore.getState().setAuth(testUser, 'tok-abc', 'http://example.com');
    await useAuthStore.getState().logout();

    expect(storage.deleteToken).toHaveBeenCalledTimes(1);
    expect(storage.deleteServerUrl).toHaveBeenCalledTimes(1);
    expect(client.setMediaToken).toHaveBeenCalledWith(null);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.serverUrl).toBeNull();
  });

  it('logout also unregisters this device push token when one is stored', async () => {
    const storage = require('@/utils/storage');
    const client = require('@/api/client');
    storage.getPushToken.mockResolvedValue('push-token-xyz');
    const { useAuthStore } = require('@/stores/authStore');

    await useAuthStore.getState().logout();

    expect(client.api.delete).toHaveBeenCalledWith('/push-tokens', { params: { token: 'push-token-xyz' } });
    expect(storage.deletePushToken).toHaveBeenCalledTimes(1);
  });

  it('clearSession deletes the token but PRESERVES the server URL', async () => {
    const storage = require('@/utils/storage');
    const client = require('@/api/client');
    const { useAuthStore } = require('@/stores/authStore');

    await useAuthStore.getState().setAuth(testUser, 'tok-abc', 'http://example.com');
    await useAuthStore.getState().clearSession();

    expect(storage.deleteToken).toHaveBeenCalledTimes(1);
    expect(storage.deleteServerUrl).not.toHaveBeenCalled();
    expect(client.setMediaToken).toHaveBeenCalledWith(null);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    // serverUrl is intentionally left as-is (not reset to null in clearSession).
    expect(state.serverUrl).toBe('http://example.com');
  });
});
