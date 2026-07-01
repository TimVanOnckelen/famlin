import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'famlin_token';

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }
  return SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.removeItem(key);
  }
  return SecureStore.deleteItemAsync(key);
}

export async function getToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function setToken(value: string): Promise<void> {
  return setItem(TOKEN_KEY, value);
}

export async function deleteToken(): Promise<void> {
  return deleteItem(TOKEN_KEY);
}
