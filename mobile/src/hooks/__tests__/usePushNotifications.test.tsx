import { renderHook, waitFor } from '@testing-library/react-native';

// expo-notifications / expo-device are mocked globally in jest.setup.js
// (getExpoPushTokenAsync resolves { data: 'test-expo-push-token' }, isDevice: true).

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@famlin/api-client', () => ({
  fetchNotificationConfig: jest.fn(),
  registerPushToken: jest.fn(),
}));

jest.mock('@/utils/storage', () => ({
  setPushToken: jest.fn().mockResolvedValue(undefined),
}));

import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuthStore } from '@/stores/authStore';
import { fetchNotificationConfig, registerPushToken } from '@famlin/api-client';
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
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it('registers the push token once when a signed-in user is present', async () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) =>
      selector({ user: { id: 'u1' } })
    );
    (fetchNotificationConfig as jest.Mock).mockResolvedValue({ pushEnabled: true });
    (registerPushToken as jest.Mock).mockResolvedValue(undefined);

    renderHook(() => usePushNotifications());

    await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(1));

    expect(fetchNotificationConfig).toHaveBeenCalledTimes(1);
    expect(registerPushToken).toHaveBeenCalledWith('test-expo-push-token');
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

    expect(registerPushToken).not.toHaveBeenCalled();
  });
});
