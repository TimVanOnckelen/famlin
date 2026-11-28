import type { E2eIdentityKeys } from '@famlin/api-client'
import { readSyncedKeys, syncKeysToCloud } from '@/e2e/keySync'
import { useE2eKeysStore } from '@/e2e/keysStore'

const restoreInFlight = new Map<string, Promise<void>>()
const mirrored = new Set<string>()

/** Silent restore from the OS-synced store; shared between components, a no-op unless the keys match the server's identity. */
export function restoreFromSyncOnce(
  scope: { serverUrl: string; userId: string },
  identity: { version: number; signPublicKey: string; boxPublicKey: string }
): Promise<void> {
  const key = `${scope.serverUrl}|${scope.userId}|${identity.version}`
  const existing = restoreInFlight.get(key)
  if (existing) return existing
  const task = (async () => {
    const found = await readSyncedKeys(scope, { userId: scope.userId, ...identity })
    if (found) await useE2eKeysStore.getState().addKeys(found, undefined, { skipSync: true })
  })().finally(() => restoreInFlight.delete(key))
  restoreInFlight.set(key, task)
  return task
}

export function mirrorOnce(
  scope: { serverUrl: string; userId: string },
  keys: E2eIdentityKeys
): Promise<boolean> | undefined {
  const key = `${scope.serverUrl}|${scope.userId}|${keys.version}`
  if (mirrored.has(key)) return undefined
  mirrored.add(key)
  return syncKeysToCloud(scope, keys)
}

/** Tests only. */
export function resetSyncRestoreState() {
  restoreInFlight.clear()
  mirrored.clear()
}
