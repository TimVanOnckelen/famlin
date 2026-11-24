import { create } from 'zustand'
import type { E2eIdentityKeys } from '@famlin/api-client'
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
  addKeys: (keys: E2eIdentityKeys, recovery?: StoredRecoveryCode) => Promise<void>
  setRecovery: (recovery: StoredRecoveryCode) => Promise<void>
  setContactPin: (contactId: string, pin: E2eContactPin) => Promise<void>
  noteEncryptedSend: () => Promise<void>
  dismissBackupReminder: () => Promise<void>
  reset: () => void
}

const empty = { scopeKey: null, scope: null, loaded: false, keys: [], recovery: null, meta: { contacts: {} } }

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

  addKeys: async (keys, recovery) => {
    const { scope } = get()
    if (!scope) throw new Error('e2e: no scope')
    await saveKeys(scope, keys)
    if (recovery) await saveRecoveryCode(scope, recovery)
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
