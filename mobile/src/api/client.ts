export * from '@famlin/api-client';

import { setApiBaseUrl, getCurrentServerUrl } from '@famlin/api-client';

// Dev convenience only — the shared package itself is platform-agnostic and
// doesn't read Expo-specific env vars, so this lives here instead. There is
// deliberately no hardcoded localhost fallback: silently targeting localhost
// when EXPO_PUBLIC_API_URL is unset would mask real failures instead of
// surfacing them. initApiBaseUrl() (called during bootstrap) still overrides
// this with any previously stored server URL.
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;
if (DEFAULT_API_URL && !getCurrentServerUrl()) {
  setApiBaseUrl(DEFAULT_API_URL);
}
