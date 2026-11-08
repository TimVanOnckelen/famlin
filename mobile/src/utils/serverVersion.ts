import AsyncStorage from '@react-native-async-storage/async-storage'
import { compareVersions } from '@famlin/api-client'

// The oldest server version this app still supports (issue #381) — the
// counterpart of the backend's `minAppVersion` (backend/src/routes/auth.ts).
// Support window: servers up to 3 minor versions behind the app
// (app 0.8.x → servers >= 0.5.0). Below it the app shows a dismissible
// warning banner, never a blocking screen.
//
// Raising this is a BREAKING CHANGE for self-hosters: mark the commit with
// `!` or a `BREAKING CHANGE:` footer (see CLAUDE.md).
export const MIN_SERVER_VERSION = '0.5.0'

const VERSION_PATTERN = /^v?\d+(\.\d+)*$/i

/**
 * True only when `version` is a parseable version strictly below
 * `minVersion`. A missing or unparseable version is never "too old" — we'd
 * rather show nothing than a wrong warning.
 */
export function isServerTooOld(version: string | null | undefined, minVersion: string = MIN_SERVER_VERSION): boolean {
  if (!version) return false
  const trimmed = version.trim()
  if (!VERSION_PATTERN.test(trimmed)) return false
  return compareVersions(trimmed, minVersion) < 0
}

/**
 * Whether the old-server banner should show: the server is too old and the
 * user hasn't dismissed it for this exact server version yet (an upgrade to
 * another still-too-old version shows it again).
 */
export function shouldShowOldServerBanner(
  version: string | null | undefined,
  dismissedVersion: string | null | undefined,
  minVersion: string = MIN_SERVER_VERSION
): boolean {
  if (!isServerTooOld(version, minVersion)) return false
  return dismissedVersion?.trim() !== version?.trim()
}

// Dismissal is remembered per server URL, holding the server version it was
// dismissed for.
export function oldServerDismissalKey(serverUrl: string): string {
  return `famlin_old_server_dismissed:${serverUrl}`
}

export async function getDismissedServerVersion(serverUrl: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(oldServerDismissalKey(serverUrl))
  } catch {
    return null
  }
}

export async function dismissOldServerBanner(serverUrl: string, version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(oldServerDismissalKey(serverUrl), version)
  } catch {
    // Best-effort: worst case the banner shows again next launch.
  }
}
