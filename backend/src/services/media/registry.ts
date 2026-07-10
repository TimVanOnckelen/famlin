import { MediaProviderError, type MediaProvider } from './types.js';
import { immichProvider } from './immich.js';
import { localProvider } from './local.js';

// The static provider registry — adding a media source (Nextcloud,
// PhotoPrism, ...) = implement MediaProvider in a new file in this directory
// and add it here. MediaAlbumLink.provider stores these ids, so they must
// never be renamed once a deployment has linked albums.
const providers = new Map<string, MediaProvider>([
  [immichProvider.id, immichProvider],
  [localProvider.id, localProvider],
]);

export function getMediaProvider(id: string): MediaProvider | undefined {
  return providers.get(id);
}

export function listMediaProviders(): MediaProvider[] {
  return [...providers.values()];
}

// Single source of truth for mapping a MediaProviderError to a translated
// key/HTTP status — every route that touches a provider imports these
// instead of re-deriving the mapping (mirrors OIDC_ERROR_KEY in
// routes/auth.ts). Immich keeps its provider-specific messages; other
// providers share the generic pair.
export function mediaErrorKey(err: MediaProviderError): string {
  if (err.provider === 'immich') {
    return err.code === 'not_configured' ? 'errors.immichNotConfigured' : 'errors.immichUnreachable';
  }
  return err.code === 'not_configured' ? 'errors.mediaSourceNotConfigured' : 'errors.mediaSourceUnavailable';
}

export function mediaErrorStatus(err: MediaProviderError): number {
  return err.code === 'not_configured' ? 400 : 502;
}

export { MediaProviderError } from './types.js';
export type { MediaProvider, MediaAssetVariant, MediaAlbumSummary, MediaAssetSummary } from './types.js';
