// The port half of a dependency-inversion seam: this package never talks to
// SecureStore/AsyncStorage (mobile) or localStorage (web) directly, since
// those are platform-specific. Each consuming app registers an adapter once
// at startup via setStorageAdapter().
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let adapter: StorageAdapter | null = null;

export function setStorageAdapter(a: StorageAdapter): void {
  adapter = a;
}

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    throw new Error('@famlin/api-client: setStorageAdapter() must be called before use');
  }
  return adapter;
}

export const TOKEN_KEY = 'famlin_token';
export const SERVER_URL_KEY = 'famlin_server_url';
