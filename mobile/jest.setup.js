/**
 * Global Jest setup for the mobile app.
 *
 * jest-expo's preset already stubs most of the native Expo/RN bridge, but a
 * few modules used by our code (secure storage, push notifications, device
 * info, constants) either have no bundled mock or would otherwise hit real
 * native code paths that don't exist in the Jest/Node environment. Mock them
 * once here so individual test files don't have to repeat the boilerplate;
 * a test file can still `jest.mock(...)` the same module locally to override
 * this default with a more specific implementation.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'test-expo-push-token' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {},
    manifest: {},
  },
}));
