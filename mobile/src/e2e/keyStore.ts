import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { E2eIdentityKeys } from '@famlin/api-client'

// Where the private halves of a user's identity live on this device (#506):
// the keychain/keystore, per server + account, never backed up or synced to
// another device. A session ending (401, restore) leaves them alone; only an
// explicit logout wipes them (see wipe.ts).

export interface E2eScope {
  serverUrl: string
  userId: string
}

export interface StoredRecoveryCode {
  code: string
  /** The user ticked "I saved it" (or restored with it). */
  confirmed: boolean
}

export interface E2eContactPin {
  /** Latest identity version and signing key we have seen for this contact. */
  version: number
  signPublicKey: string
  /** The user dismissed the "security code changed" notice for this pin. */
  acknowledged: boolean
  /** The safety code the user confirmed matches, if any. */
  verifiedSafetyCode?: string
}

export interface E2eMeta {
  contacts: Record<string, E2eContactPin>
  /** Encrypted messages this account sent from this device (drives the backup reminder). */
  encryptedSent?: number
  /** When the backup reminder was dismissed (ms since epoch). */
  backupReminderDismissedAt?: number
}

// SecureStore keys may only contain [A-Za-z0-9._-]: hash the scope.
function fnv(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function scopeId(scope: E2eScope): string {
  const text = `${scope.serverUrl.trim().replace(/\/+$/, '').toLowerCase()}\n${scope.userId}`
  return fnv(text, 2166136261) + fnv(text, 0x9747b28c)
}

const keyOf = (scope: E2eScope, suffix: string) => `famlin_e2e_${scopeId(scope)}_${suffix}`

const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }

async function secureGet(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key, secureOptions)
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value)
  return SecureStore.setItemAsync(key, value, secureOptions)
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.removeItem(key)
  return SecureStore.deleteItemAsync(key, secureOptions)
}

async function readVersions(scope: E2eScope): Promise<number[]> {
  const raw = await secureGet(keyOf(scope, 'idx'))
  if (!raw) return []
  return raw
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1)
}

/** Every identity version this device holds for the account, newest first. */
export async function loadKeys(scope: E2eScope): Promise<E2eIdentityKeys[]> {
  const versions = await readVersions(scope)
  const keys: E2eIdentityKeys[] = []
  for (const version of versions) {
    const raw = await secureGet(keyOf(scope, `k${version}`))
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as E2eIdentityKeys
      if (parsed.userId === scope.userId && parsed.version === version) keys.push(parsed)
    } catch {
      // A damaged entry is skipped: the device then reads as "needs restore".
    }
  }
  return keys.sort((a, b) => b.version - a.version)
}

export async function saveKeys(scope: E2eScope, keys: E2eIdentityKeys): Promise<void> {
  await secureSet(keyOf(scope, `k${keys.version}`), JSON.stringify(keys))
  const versions = new Set(await readVersions(scope))
  versions.add(keys.version)
  await secureSet(keyOf(scope, 'idx'), [...versions].sort((a, b) => a - b).join(','))
}

export async function loadRecoveryCode(scope: E2eScope): Promise<StoredRecoveryCode | null> {
  const raw = await secureGet(keyOf(scope, 'rc'))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredRecoveryCode
    return typeof parsed.code === 'string' ? { code: parsed.code, confirmed: !!parsed.confirmed } : null
  } catch {
    return null
  }
}

export async function saveRecoveryCode(scope: E2eScope, value: StoredRecoveryCode): Promise<void> {
  await secureSet(keyOf(scope, 'rc'), JSON.stringify(value))
}

export async function loadMeta(scope: E2eScope): Promise<E2eMeta> {
  const raw = await AsyncStorage.getItem(keyOf(scope, 'meta'))
  if (!raw) return { contacts: {} }
  try {
    const parsed = JSON.parse(raw) as E2eMeta
    return { ...parsed, contacts: parsed.contacts ?? {} }
  } catch {
    return { contacts: {} }
  }
}

export async function saveMeta(scope: E2eScope, meta: E2eMeta): Promise<void> {
  await AsyncStorage.setItem(keyOf(scope, 'meta'), JSON.stringify(meta))
}

/** Forget everything this device holds for the account: keys, recovery code, pins. */
export async function wipeScope(scope: E2eScope): Promise<void> {
  const versions = await readVersions(scope)
  await Promise.all([
    ...versions.map((version) => secureDelete(keyOf(scope, `k${version}`)).catch(() => {})),
    secureDelete(keyOf(scope, 'idx')).catch(() => {}),
    secureDelete(keyOf(scope, 'rc')).catch(() => {}),
    AsyncStorage.removeItem(keyOf(scope, 'meta')).catch(() => {}),
  ])
}
