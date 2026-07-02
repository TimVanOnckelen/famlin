import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'famlin_token';
const SERVER_URL_KEY = 'famlin_server_url';
const LANGUAGE_KEY = 'famlin_language';
const PUSH_TOKEN_KEY = 'famlin_push_token';

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

export async function getServerUrl(): Promise<string | null> {
  return getItem(SERVER_URL_KEY);
}

export async function setServerUrl(value: string): Promise<void> {
  return setItem(SERVER_URL_KEY, value);
}

export async function deleteServerUrl(): Promise<void> {
  return deleteItem(SERVER_URL_KEY);
}

export async function getLanguage(): Promise<string | null> {
  return getItem(LANGUAGE_KEY);
}

export async function setLanguage(value: string): Promise<void> {
  return setItem(LANGUAGE_KEY, value);
}

export async function deleteLanguage(): Promise<void> {
  return deleteItem(LANGUAGE_KEY);
}

export async function getPushToken(): Promise<string | null> {
  return getItem(PUSH_TOKEN_KEY);
}

export async function setPushToken(value: string): Promise<void> {
  return setItem(PUSH_TOKEN_KEY, value);
}

export async function deletePushToken(): Promise<void> {
  return deleteItem(PUSH_TOKEN_KEY);
}
