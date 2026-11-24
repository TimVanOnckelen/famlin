import type { E2ePublicIdentity } from '@famlin/api-client'
import type { E2eContactPin } from '@/e2e/keyStore'

/**
 * Trust on first sight: remember the latest identity version + signing key we
 * saw for a contact; when either changes, flag it until the user dismisses the
 * notice. `changed` is what the conversation banner shows.
 */
export function evaluateContactPin(
  previous: E2eContactPin | undefined,
  latest: Pick<E2ePublicIdentity, 'version' | 'signPublicKey'>
): { pin: E2eContactPin; changed: boolean; write: boolean } {
  if (!previous) {
    return {
      pin: { version: latest.version, signPublicKey: latest.signPublicKey, acknowledged: true },
      changed: false,
      write: true,
    }
  }
  if (previous.version === latest.version && previous.signPublicKey === latest.signPublicKey) {
    return { pin: previous, changed: !previous.acknowledged, write: false }
  }
  // Only a newer version is a legitimate reset; never re-pin an older one silently.
  return {
    pin: { version: latest.version, signPublicKey: latest.signPublicKey, acknowledged: false },
    changed: true,
    write: true,
  }
}

export function isSafetyCodeVerified(pin: E2eContactPin | undefined, currentSafetyCode: string | null): boolean {
  return !!pin?.verifiedSafetyCode && pin.verifiedSafetyCode === currentSafetyCode
}
