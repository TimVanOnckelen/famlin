import { assertKeysMatchIdentity, type E2eIdentityKeys, type E2ePublicIdentity } from '@famlin/api-client'
import * as KeySync from '../../modules/famlin-key-sync'
import { scopeId, type E2eScope } from '@/e2e/keyStore'

// The identity's latest keys, mirrored into the OS's synced secret store
// (iCloud Keychain / Google Block Store) so a new phone gets them back without
// the person doing anything. The item name is the same server + account hash
// as the local key store, so it is found after logging in again on a new phone.
//
// IMPORTANT: sign-out must never delete this item: deleting a synced item
// deletes it on every device of the person. Only overwrite it with newer keys.

export type { KeySyncAvailability } from '../../modules/famlin-key-sync'

const itemKey = (scope: E2eScope) => `famlin_e2e_${scopeId(scope)}`

/** Mirror these keys to the synced store. Never throws: syncing is best effort. */
export async function syncKeysToCloud(scope: E2eScope, keys: E2eIdentityKeys): Promise<boolean> {
  try {
    await KeySync.setItem(itemKey(scope), JSON.stringify({ v: 1, userId: scope.userId, keys }))
    return true
  } catch {
    return false
  }
}

/**
 * The synced keys, only if they really are the private half of `expected`
 * (the latest identity the server publishes); anything else is ignored.
 */
export async function readSyncedKeys(scope: E2eScope, expected: E2ePublicIdentity): Promise<E2eIdentityKeys | null> {
  try {
    const raw = await KeySync.getItem(itemKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: number; userId?: string; keys?: E2eIdentityKeys }
    if (parsed.v !== 1 || parsed.userId !== scope.userId || !parsed.keys) return null
    assertKeysMatchIdentity(parsed.keys, expected)
    return parsed.keys
  } catch {
    return null
  }
}

export function getKeySyncAvailability(): Promise<KeySync.KeySyncAvailability> {
  return KeySync.isAvailable()
}
