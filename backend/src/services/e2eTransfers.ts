import type { z } from 'zod'
import type { transferPayloadSchema } from '../types.js'

// Relay for the QR device-to-device key hand-over (issue #506). The new device
// shows a QR with a random session id and an ephemeral public key; the
// already-signed-in device encrypts the identity for that key and PUTs the
// ciphertext here; the new device GETs it once. The server only ever holds
// ciphertext, briefly. In-memory and single-instance, like oidcHandoff.ts.
const TRANSFER_TTL_MS = 10 * 60 * 1000
const MAX_TRANSFERS = 1000

export type TransferPayload = z.infer<typeof transferPayloadSchema>

interface TransferEntry {
  userId: string
  payload: TransferPayload
  expiresAt: number
}

const transfers = new Map<string, TransferEntry>()

function sweepExpired() {
  const now = Date.now()
  for (const [id, entry] of transfers) {
    if (entry.expiresAt < now) transfers.delete(id)
  }
}

export type PutTransferResult = 'stored' | 'exists' | 'full'

export function putTransfer(sessionId: string, userId: string, payload: TransferPayload): PutTransferResult {
  sweepExpired()
  if (transfers.has(sessionId)) return 'exists'
  if (transfers.size >= MAX_TRANSFERS) return 'full'
  transfers.set(sessionId, { userId, payload, expiresAt: Date.now() + TRANSFER_TTL_MS })
  return 'stored'
}

// One-shot: a matching read deletes the entry. Another user's read leaves it.
export function takeTransfer(sessionId: string, userId: string): TransferPayload | null {
  const entry = transfers.get(sessionId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    transfers.delete(sessionId)
    return null
  }
  if (entry.userId !== userId) return null
  transfers.delete(sessionId)
  return entry.payload
}

export function resetTransfersForTests() {
  transfers.clear()
}
