import { requireOptionalNativeModule } from 'expo'

// A tiny secret store that the OS syncs to the user's other devices: iCloud
// Keychain on iOS (synchronizable keychain items), Google Block Store on
// Android. Used to carry the encrypted-message keys to a new phone without the
// user doing anything. The native module may be missing (a dev client built
// before it existed, web, jest): then everything is a quiet no-op.

export interface KeySyncAvailability {
  available: boolean
  /** Android: whether Google encrypts the backup end to end (needs a screen lock). iOS can't tell: null. */
  endToEndEncrypted: boolean | null
}

interface NativeKeySync {
  isAvailable(): Promise<KeySyncAvailability>
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  deleteItem(key: string): Promise<void>
}

/**
 * Block Store's documented MAX_SIZE (BlockstoreClient reference) is 1024 bytes
 * per entry, 16 entries per app; the same bound applies on iOS for parity.
 */
export const KEY_SYNC_MAX_ITEM_BYTES = 1024

export class KeySyncError extends Error {
  readonly code: 'too_large'
  constructor(code: 'too_large') {
    super(`key sync: ${code}`)
    this.name = 'KeySyncError'
    this.code = code
  }
}

function native(): NativeKeySync | null {
  try {
    return requireOptionalNativeModule<NativeKeySync>('FamlinKeySync')
  } catch {
    return null
  }
}

export async function isAvailable(): Promise<KeySyncAvailability> {
  const module = native()
  if (!module) return { available: false, endToEndEncrypted: null }
  try {
    return await module.isAvailable()
  } catch {
    return { available: false, endToEndEncrypted: null }
  }
}

export async function getItem(key: string): Promise<string | null> {
  const module = native()
  if (!module) return null
  try {
    return (await module.getItem(key)) ?? null
  } catch {
    return null
  }
}

/** Throws KeySyncError('too_large') over the entry limit; other failures reject from the native side. */
export async function setItem(key: string, value: string): Promise<void> {
  if (new TextEncoder().encode(value).length > KEY_SYNC_MAX_ITEM_BYTES) throw new KeySyncError('too_large')
  const module = native()
  if (!module) return
  await module.setItem(key, value)
}

export async function deleteItem(key: string): Promise<void> {
  await native()?.deleteItem(key)
}
