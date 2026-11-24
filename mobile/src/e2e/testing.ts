// In-memory stand-ins for the keychain and AsyncStorage.
export function installMemoryStores() {
  const secure = new Map<string, string>()
  const async = new Map<string, string>()
  const SecureStore: any = require('expo-secure-store')
  SecureStore.getItemAsync.mockImplementation(async (key: any) => secure.get(key) ?? null)
  SecureStore.setItemAsync.mockImplementation(async (key: any, value: any) => void secure.set(key, value))
  SecureStore.deleteItemAsync.mockImplementation(async (key: any) => void secure.delete(key))
  const AsyncStorage = require('@react-native-async-storage/async-storage')
  const storage: any = AsyncStorage.default ?? AsyncStorage
  jest.spyOn(storage, 'getItem').mockImplementation(async (key: any) => async.get(key) ?? null)
  jest.spyOn(storage, 'setItem').mockImplementation(async (key: any, value: any) => void async.set(key, value))
  jest.spyOn(storage, 'removeItem').mockImplementation(async (key: any) => void async.delete(key))
  return { secure, async }
}
