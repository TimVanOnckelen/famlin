import type { QueryClient } from '@tanstack/react-query'
import {
  createTransferRequest,
  E2eError,
  e2eMyIdentitiesQueryKey,
  formatRecoveryCode,
  generateIdentity,
  generateRecoveryCode,
  normalizeRecoveryCode,
  openRecoveryBackup,
  openTransfer,
  publishE2eIdentity,
  putE2eTransfer,
  sealRecoveryBackup,
  sealTransfer,
  takeE2eTransfer,
  updateE2eRecoveryBackup,
  type E2eOwnIdentity,
} from '@famlin/api-client'
import { useE2eKeysStore } from '@/e2e/keysStore'

const TRANSFER_POLL_MS = 2000
const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000

function publicOf(identity: E2eOwnIdentity, userId: string) {
  return {
    userId,
    version: identity.version,
    signPublicKey: identity.signPublicKey,
    boxPublicKey: identity.boxPublicKey,
  }
}

function refreshIdentities(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: e2eMyIdentitiesQueryKey() })
}

const setupInFlight = new Map<string, Promise<void>>()

/**
 * Creates this account's identity (version 1, or latest + 1 on a reset) and
 * publishes it WITHOUT a recovery backup: encryption simply works, and a
 * backup is offered later (createBackup). Concurrent callers share one
 * request. On a 409 (another device published first) the identities are
 * refetched, which turns the status into needsRestore; nothing is retried.
 */
export function createIdentity(opts: {
  userId: string
  serverIdentities: E2eOwnIdentity[]
  queryClient: QueryClient
}): Promise<void> {
  const flightKey = opts.userId
  const existing = setupInFlight.get(flightKey)
  if (existing) return existing
  const task = (async () => {
    const version = Math.max(0, ...opts.serverIdentities.map((identity) => identity.version)) + 1
    const keys = generateIdentity(opts.userId, version)
    try {
      await publishE2eIdentity({
        version,
        signPublicKey: keys.signPublicKey,
        boxPublicKey: keys.boxPublicKey,
      })
    } catch (error) {
      await refreshIdentities(opts.queryClient)
      throw error
    }
    await useE2eKeysStore.getState().addKeys(keys)
    await refreshIdentities(opts.queryClient)
  })().finally(() => setupInFlight.delete(flightKey))
  setupInFlight.set(flightKey, task)
  return task
}

export async function confirmRecoverySaved(): Promise<void> {
  const { recovery, setRecovery } = useE2eKeysStore.getState()
  if (recovery) await setRecovery({ ...recovery, confirmed: true })
}

export type BackupMethod = 'recoveryCode'

/**
 * The one place a backup of the identity is created (and so the one place
 * that touches `recoveryBackup`, with restoreWithCode below). Today the only
 * method is a recovery code; others (e.g. a passkey) plug in here.
 */
export async function createBackup(
  method: BackupMethod,
  opts: { latestVersion: number; queryClient: QueryClient }
): Promise<{ code: string }> {
  const { keys, setRecovery } = useE2eKeysStore.getState()
  const latest = keys.find((candidate) => candidate.version === opts.latestVersion)
  if (!latest) throw new E2eError('identity_mismatch')
  if (method !== 'recoveryCode') throw new E2eError('unknown_version')
  const code = generateRecoveryCode()
  await updateE2eRecoveryBackup(latest.version, sealRecoveryBackup(latest, code))
  await setRecovery({ code, confirmed: false })
  await refreshIdentities(opts.queryClient)
  return { code }
}

/** Restore the latest identity's keys with the recovery code. Throws E2eError (wrong/invalid code). */
export async function restoreWithCode(opts: {
  userId: string
  code: string
  latest: E2eOwnIdentity
  queryClient: QueryClient
}): Promise<void> {
  if (!opts.latest.recoveryBackup) throw new E2eError('corrupt')
  const keys = openRecoveryBackup(opts.latest.recoveryBackup, opts.code, publicOf(opts.latest, opts.userId))
  const code = formatRecoveryCode(normalizeRecoveryCode(opts.code))
  await useE2eKeysStore.getState().addKeys(keys, { code, confirmed: true })
  await refreshIdentities(opts.queryClient)
}

export interface TransferSession {
  /** What to show as a QR code. */
  qr: string
  /** Resolves once the keys arrived and were stored; rejects on timeout or cancel. */
  done: Promise<void>
  cancel: () => void
}

/** New device: show a QR, then wait for an existing device to hand the keys over. */
export function startTransfer(opts: {
  userId: string
  latest: E2eOwnIdentity
  queryClient: QueryClient
}): TransferSession {
  const request = createTransferRequest()
  let cancelled = false
  const done = (async () => {
    const deadline = Date.now() + TRANSFER_TIMEOUT_MS
    while (!cancelled && Date.now() < deadline) {
      const payload = await takeE2eTransfer(request.sessionId).catch(() => null)
      if (payload) {
        const keys = openTransfer(payload, request, publicOf(opts.latest, opts.userId))
        const existing = useE2eKeysStore.getState().recovery
        await useE2eKeysStore.getState().addKeys(keys, existing ?? undefined)
        await refreshIdentities(opts.queryClient)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, TRANSFER_POLL_MS))
    }
    throw new Error(cancelled ? 'cancelled' : 'timeout')
  })()
  return { qr: request.qr, done, cancel: () => (cancelled = true) }
}

/** Existing device: seal the identity to the QR a new device is showing. */
export async function approveTransfer(opts: { qr: string; latestVersion: number }): Promise<void> {
  const keys = useE2eKeysStore.getState().keys.find((candidate) => candidate.version === opts.latestVersion)
  if (!keys) throw new E2eError('identity_mismatch')
  const { sessionId, payload } = sealTransfer(keys, opts.qr)
  await putE2eTransfer(sessionId, payload)
}
