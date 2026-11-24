import type { E2eStatus } from '@/e2e/status'

export type PlaintextReason =
  /** The administrator turned encryption off for the whole server. */
  | 'serverDisabled'
  /** A participant turned encryption off for this conversation. */
  | 'disabled'
  /** The other person hasn't published any identity yet. */
  | 'peerNoKey'
  /** Automatic setup of my keys failed. */
  | 'needsSetup'
  /** The server has my identity but this device lacks its keys. */
  | 'needsRestore'
  /** The server doesn't do encrypted messages. */
  | 'unsupported'

export type SendDecision =
  | { kind: 'encrypt' }
  | { kind: 'plaintext'; reason: PlaintextReason }
  /** Not enough is known yet: don't send, so nothing leaves unencrypted by accident. */
  | { kind: 'wait' }

/**
 * Encrypt iff the server supports it, this device holds the keys for my latest
 * server identity version, the other person has at least one identity and
 * nobody switched encryption off. Everything else is plaintext, and the
 * reason is what the conversation banner shows.
 */
export function decideSend(input: {
  status: E2eStatus
  /** How many identity versions the other person published; undefined while loading. */
  peerIdentityCount: number | undefined
  encryptionDisabledAt: string | null | undefined
  /** The automatic first-time setup failed (e.g. the server was unreachable). */
  setupFailed?: boolean
  /** The server's policy says encryption is off (DMs stay on). Beats every other reason. */
  serverEncryptionDisabled?: boolean
}): SendDecision {
  if (input.serverEncryptionDisabled) return { kind: 'plaintext', reason: 'serverDisabled' }
  if (input.status === 'unsupported') return { kind: 'plaintext', reason: 'unsupported' }
  if (input.status === 'loading') return { kind: 'wait' }
  if (input.encryptionDisabledAt) return { kind: 'plaintext', reason: 'disabled' }
  // Keys are created silently the first time a conversation opens; until then nothing is sent.
  if (input.status === 'needsSetup') {
    return input.setupFailed ? { kind: 'plaintext', reason: 'needsSetup' } : { kind: 'wait' }
  }
  if (input.status === 'needsRestore') return { kind: 'plaintext', reason: 'needsRestore' }
  if (input.peerIdentityCount === undefined) return { kind: 'wait' }
  if (input.peerIdentityCount === 0) return { kind: 'plaintext', reason: 'peerNoKey' }
  return { kind: 'encrypt' }
}
