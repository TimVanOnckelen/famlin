import { renderHook, waitFor } from '@testing-library/react-native';

// expo-notifications / expo-device are mocked globally in jest.setup.js
// (getExpoPushTokenAsync resolves { data: 'test-expo-push-token' }, isDevice: true).

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/api/auth', () => ({
  fetchNotificationConfig: jest.fn(),
}));

jest.mock('@/api/client', () => ({
  api: { post: jest.fn() },
}));

jest.mock('@/utils/storage', () => ({
  setPushToken: jest.fn().mockResolvedValue(undefined),
}));

import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuthStore } from '@/stores/authStore';
import { fetchNotificationConfig } from '@/api/auth';
import { api } from '@/api/client';
import { setPushToken } from '@/utils/storage';

describe('usePushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not attempt registration when there is no signed-in user', async () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) => selector({ user: null }));

    renderHook(() => usePushNotifications());

    // Give any stray microtask a chance to run before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchNotificationConfig).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('registers the push token once when a signed-in user is present', async () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) =>
      selector({ user: { id: 'u1' } })
    );
    (fetchNotificationConfig as jest.Mock).mockResolvedValue({ pushEnabled: true });
    (api.post as jest.Mock).mockResolvedValue({});

    renderHook(() => usePushNotifications());

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    expect(fetchNotificationConfig).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/push-tokens', { token: 'test-expo-push-token' });
    expect(setPushToken).toHaveBeenCalledWith('test-expo-push-token');
  });

  it('does not register when the server reports push notifications disabled', async () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) =>
      selector({ user: { id: 'u1' } })
    );
    (fetchNotificationConfig as jest.Mock).mockResolvedValue({ pushEnabled: false });

    renderHook(() => usePushNotifications());

    await waitFor(() => expect(fetchNotificationConfig).toHaveBeenCalledTimes(1));
    // Let the (short-circuited) async path settle before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.post).not.toHaveBeenCalled();
  });
});
