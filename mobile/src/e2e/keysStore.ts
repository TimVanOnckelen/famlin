import { create } from 'zustand'
import type { E2eIdentityKeys } from '@famlin/api-client'
import { syncKeysToCloud } from '@/e2e/keySync'
import {
  loadKeys,
  loadMeta,
  loadRecoveryCode,
  saveKeys,
  saveMeta,
  saveRecoveryCode,
  scopeId,
  type E2eContactPin,
  type E2eMeta,
  type E2eScope,
  type StoredRecoveryCode,
} from '@/e2e/keyStore'

interface E2eKeysState {
  scopeKey: string | null
  scope: E2eScope | null
  loaded: boolean
  /** Every identity version held on this device, newest first. */
  keys: E2eIdentityKeys[]
  recovery: StoredRecoveryCode | null
  meta: E2eMeta
  loadForScope: (scope: E2eScope) => Promise<void>
  /** Stores keys on this device and, when they are the newest version, mirrors them to the synced store. */
  addKeys: (keys: E2eIdentityKeys, recovery?: StoredRecoveryCode, opts?: { skipSync?: boolean }) => Promise<void>
  /** The latest server identity version the synced store was already tried for. */
  syncCheckedVersion: number | null
  markSyncChecked: (version: number) => void
  setRecovery: (recovery: StoredRecoveryCode) => Promise<void>
  setContactPin: (contactId: string, pin: E2eContactPin) => Promise<void>
  noteEncryptedSend: () => Promise<void>
  dismissBackupReminder: () => Promise<void>
  reset: () => void
}

const empty = {
  scopeKey: null,
  scope: null,
  loaded: false,
  keys: [],
  recovery: null,
  meta: { contacts: {} },
  syncCheckedVersion: null,
}

export const useE2eKeysStore = create<E2eKeysState>((set, get) => ({
  ...empty,

  loadForScope: async (scope) => {
    const key = scopeId(scope)
    if (get().scopeKey === key && get().loaded) return
    set({ ...empty, scopeKey: key, scope })
    const [keys, recovery, meta] = await Promise.all([loadKeys(scope), loadRecoveryCode(scope), loadMeta(scope)])
    // The account may have changed while reading.
    if (get().scopeKey !== key) return
    set({ keys, recovery, meta, loaded: true })
  },

  syncCheckedVersion: null,
  markSyncChecked: (version) => set({ syncCheckedVersion: version }),

  addKeys: async (keys, recovery, opts) => {
    const { scope } = get()
    if (!scope) throw new Error('e2e: no scope')
    await saveKeys(scope, keys)
    if (recovery) await saveRecoveryCode(scope, recovery)
    const newest = Math.max(0, ...get().keys.map((existing) => existing.version)) <= keys.version
    if (newest && !opts?.skipSync) void syncKeysToCloud(scope, keys)
    set((state) => ({
      keys: [keys, ...state.keys.filter((existing) => existing.version !== keys.version)].sort(
        (a, b) => b.version - a.version
      ),
      recovery: recovery ?? state.recovery,
    }))
  },

  setRecovery: async (recovery) => {
    const { scope } = get()
    if (!scope) throw new Error('e2e: no scope')
    await saveRecoveryCode(scope, recovery)
    set({ recovery })
  },

  setContactPin: async (contactId, pin) => {
    const { scope, meta } = get()
    if (!scope) return
    const next = { ...meta, contacts: { ...meta.contacts, [contactId]: pin } }
    set({ meta: next })
    await saveMeta(scope, next)
  },

  noteEncryptedSend: async () => {
    const { scope, meta } = get()
    if (!scope) return
    const next = { ...meta, encryptedSent: (meta.encryptedSent ?? 0) + 1 }
    set({ meta: next })
    await saveMeta(scope, next)
  },

  dismissBackupReminder: async () => {
    const { scope, meta } = get()
    if (!scope) return
    const next = { ...meta, backupReminderDismissedAt: Date.now() }
    set({ meta: next })
    await saveMeta(scope, next)
  },

  reset: () => set({ ...empty }),
}))
