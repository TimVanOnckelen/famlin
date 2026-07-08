jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('async-value'),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('secure-value'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

describe('mobileStorageAdapter', () => {
  it('delegates getItem/setItem/removeItem to the underlying primitives (SecureStore on native)', async () => {
    const SecureStore = require('expo-secure-store');
    const { mobileStorageAdapter } = require('@/utils/storage');

    await expect(mobileStorageAdapter.getItem('famlin_token')).resolves.toBe('secure-value');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('famlin_token');

    await mobileStorageAdapter.setItem('famlin_token', 'abc');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('famlin_token', 'abc');

    await mobileStorageAdapter.removeItem('famlin_token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('famlin_token');
  });
});
