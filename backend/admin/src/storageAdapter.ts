import type { StorageAdapter } from '@famlin/api-client';

// The shared package's browser OIDC helpers (oidcBrowser.ts) go through its
// own axios client (client.ts), which reads/writes tokens via a
// StorageAdapter the package never assumes on its own — see
// setStorageAdapter() there. Admin doesn't otherwise use the package's axios
// client or token storage (it keeps its own localStorage key and its own
// api/client.ts for every admin-facing endpoint), so this adapter exists only
// to satisfy that requirement for the OIDC login round trip.
export const adminLocalStorageAdapter: StorageAdapter = {
  getItem: async (key) => window.localStorage.getItem(key),
  setItem: async (key, value) => {
    window.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    window.localStorage.removeItem(key);
  },
};
