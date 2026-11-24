import {
  encryptMessage,
  generateIdentity,
  publicIdentity,
  type ChatConversation,
  type E2eOwnIdentity,
} from '@famlin/api-client'
import { decideSend } from '../sendRule'
import { computeE2eStatus } from '../status'
import { clearE2eCache } from '../cache'
import { decryptChatPayload, decryptErrorKey, dedupeByMid } from '../decrypt'
import { evaluateContactPin, isSafetyCodeVerified } from '../contactPin'
import { chatConversationPreview } from '@/utils/chatConversations'
import { shouldShowBackupReminder } from '../backupReminder'
import { parseSafetyQr, safetyQrPayload } from '../safetyQr'

describe('decideSend', () => {
  const ready = { status: 'ready' as const, peerIdentityCount: 1, encryptionDisabledAt: null }

  it('encrypts only when every condition holds', () => {
    expect(decideSend(ready)).toEqual({ kind: 'encrypt' })
  })

  it('sends plaintext with a reason for each way encryption is unavailable', () => {
    expect(decideSend({ ...ready, status: 'unsupported' })).toEqual({ kind: 'plaintext', reason: 'unsupported' })
    expect(decideSend({ ...ready, status: 'needsSetup', setupFailed: true })).toEqual({
      kind: 'plaintext',
      reason: 'needsSetup',
    })
    expect(decideSend({ ...ready, status: 'needsRestore' })).toEqual({ kind: 'plaintext', reason: 'needsRestore' })
    expect(decideSend({ ...ready, peerIdentityCount: 0 })).toEqual({ kind: 'plaintext', reason: 'peerNoKey' })
    expect(decideSend({ ...ready, encryptionDisabledAt: '2026-01-01T00:00:00Z' })).toEqual({
      kind: 'plaintext',
      reason: 'disabled',
    })
  })

  it('explains an opt-out before missing keys', () => {
    expect(
      decideSend({ status: 'needsSetup', peerIdentityCount: 0, encryptionDisabledAt: '2026-01-01T00:00:00Z' })
    ).toEqual({ kind: 'plaintext', reason: 'disabled' })
  })

  it('waits instead of silently sending plaintext while anything is still loading', () => {
    expect(decideSend({ ...ready, status: 'loading' })).toEqual({ kind: 'wait' })
    // Keys are being created silently: hold the message rather than send it in the clear.
    expect(decideSend({ ...ready, status: 'needsSetup' })).toEqual({ kind: 'wait' })
    expect(decideSend({ ...ready, peerIdentityCount: undefined })).toEqual({ kind: 'wait' })
  })
})

describe('computeE2eStatus', () => {
  const serverIdentity = (version: number): E2eOwnIdentity => ({
    version,
    signPublicKey: 's',
    boxPublicKey: 'b',
    createdAt: '2026-01-01T00:00:00Z',
    recoveryBackup: null,
  })
  const base = { featureSupport: 'supported' as const, identitiesLoading: false, keysLoaded: true }

  it('walks the state machine', () => {
    expect(computeE2eStatus({ ...base, featureSupport: 'unsupported', serverIdentities: [], localKeys: [] })).toBe(
      'unsupported'
    )
    expect(computeE2eStatus({ ...base, keysLoaded: false, serverIdentities: [], localKeys: [] })).toBe('loading')
    expect(computeE2eStatus({ ...base, identitiesLoading: true, serverIdentities: undefined, localKeys: [] })).toBe(
      'loading'
    )
    expect(computeE2eStatus({ ...base, serverIdentities: [], localKeys: [] })).toBe('needsSetup')
    expect(computeE2eStatus({ ...base, serverIdentities: [serverIdentity(1)], localKeys: [] })).toBe('needsRestore')
    // Keys only for an older version: the latest still has to be restored.
    expect(
      computeE2eStatus({
        ...base,
        serverIdentities: [serverIdentity(2), serverIdentity(1)],
        localKeys: [generateIdentity('me', 1)],
      })
    ).toBe('needsRestore')
    expect(
      computeE2eStatus({
        ...base,
        serverIdentities: [serverIdentity(2), serverIdentity(1)],
        localKeys: [generateIdentity('me', 2), generateIdentity('me', 1)],
      })
    ).toBe('ready')
  })
})

describe('decrypting messages', () => {
  const me = generateIdentity('me', 1)
  const ana = generateIdentity('ana', 1)
  const eve = generateIdentity('eve', 1)
  const seal = (content: { mid: string; text?: string }, sender = ana, to = [publicIdentity(me)]) =>
    encryptMessage({ conversationId: 'c1', sender, recipients: to, content })
  const input = (payload: unknown, overrides = {}) => ({
    messageId: 'm1',
    conversationId: 'c1',
    authorId: 'ana',
    payload,
    myKeys: [me],
    senderIdentities: [publicIdentity(ana)],
    ...overrides,
  })

  beforeEach(() => clearE2eCache())

  it('opens a message and caches it by id', () => {
    const payload = seal({ mid: 'a', text: 'hello' })
    expect(decryptChatPayload(input(payload))).toEqual({ status: 'ok', content: { mid: 'a', text: 'hello' } })
    // Served from the cache even when nothing else is available.
    expect(decryptChatPayload(input(null, { myKeys: [], senderIdentities: undefined })).status).toBe('ok')
  })

  it('reports why a message cannot be read, never an empty bubble', () => {
    const payload = seal({ mid: 'a', text: 'hi' })
    expect(decryptChatPayload(input(payload, { myKeys: [] }))).toEqual({ status: 'error', code: 'no_key_for_me' })
    expect(decryptChatPayload(input(payload, { myKeys: [generateIdentity('me', 7)] }))).toEqual({
      status: 'error',
      code: 'no_key_for_me',
    })
    expect(decryptChatPayload(input(payload, { senderIdentities: undefined }))).toEqual({ status: 'pending' })
    expect(decryptChatPayload(input(payload, { senderIdentities: [] }))).toEqual({
      status: 'error',
      code: 'missing_identity',
    })
    expect(decryptChatPayload(input(payload, { authorId: 'eve' }))).toMatchObject({ status: 'error' })
    expect(decryptChatPayload(input({ ...payload, v: 2 }))).toEqual({ status: 'error', code: 'unknown_version' })
    expect(decryptChatPayload(input('garbage'))).toEqual({ status: 'error', code: 'corrupt' })
  })

  it('rejects a message whose signature is not by the claimed author', () => {
    const forged = seal({ mid: 'a', text: 'pay me' }, eve)
    expect(decryptChatPayload(input(forged))).toEqual({ status: 'error', code: 'bad_signature' })
  })

  it('maps every failure to a user-facing text key', () => {
    expect(decryptErrorKey('no_key_for_me')).toBe('e2e.error.noKeyForMe')
    expect(decryptErrorKey('unknown_version')).toBe('e2e.error.unknownVersion')
    expect(decryptErrorKey('bad_signature')).toBe('e2e.error.badSignature')
    expect(decryptErrorKey('corrupt')).toBe('e2e.error.corrupt')
    expect(decryptErrorKey('missing_identity')).toBe('e2e.error.corrupt')
  })

  it('drops later duplicates of the same mid, keeping the oldest', () => {
    // Newest first, like the message list.
    const messages = [
      { id: '3', mid: 'a' },
      { id: '2', mid: 'b' },
      { id: '1', mid: 'a' },
      { id: '0', mid: undefined },
    ]
    expect(
      dedupeByMid(
        messages,
        (m) => m.id,
        (m) => m.mid
      ).map((m) => m.id)
    ).toEqual(['2', '1', '0'])
  })
})

describe('inbox preview of encrypted messages', () => {
  const conversation = (encryption: string): ChatConversation => ({
    id: 'c1',
    kind: 'PRIVATE',
    participants: [],
    lastMessage: {
      id: 'm1',
      authorId: 'ana',
      content: null,
      hasAttachment: false,
      createdAt: '2026-01-01T00:00:00Z',
      encryption,
      encryptedPayload: {},
    },
    unreadCount: 0,
    updatedAt: '2026-01-01T00:00:00Z',
  })

  it('shows the decrypted text, a photo label, or a generic lock line', () => {
    expect(
      chatConversationPreview(conversation('v1'), () => ({ status: 'ok', content: { mid: 'a', text: 'Dinner?' } }))
    ).toEqual({ key: 'chat.previewText', text: 'Dinner?', encrypted: true })
    expect(
      chatConversationPreview(conversation('v1'), () => ({
        status: 'ok',
        content: { mid: 'a', attachment: { url: 'u', key: 'k', nonce: 'n', mime: 'image/jpeg', size: 1 } },
      }))
    ).toEqual({ key: 'chat.previewPhoto', encrypted: true })
    expect(chatConversationPreview(conversation('v1'), () => ({ status: 'error', code: 'no_key_for_me' }))).toEqual({
      key: 'chat.previewEncrypted',
      encrypted: true,
    })
    expect(chatConversationPreview(conversation('v1'))).toEqual({ key: 'chat.previewEncrypted', encrypted: true })
  })

  it('never previews formats it does not know', () => {
    expect(chatConversationPreview(conversation('v9'), () => ({ status: 'pending' }))).toEqual({
      key: 'chat.unsupportedEncryption',
    })
  })
})

describe('contact key pinning', () => {
  const latest = { version: 1, signPublicKey: 'sign-1' }

  it('trusts the first identity it sees without a notice', () => {
    expect(evaluateContactPin(undefined, latest)).toEqual({
      pin: { version: 1, signPublicKey: 'sign-1', acknowledged: true },
      changed: false,
      write: true,
    })
  })

  it('stays quiet while nothing changed', () => {
    const pin = { version: 1, signPublicKey: 'sign-1', acknowledged: true }
    expect(evaluateContactPin(pin, latest)).toEqual({ pin, changed: false, write: false })
  })

  it('flags a new version or a different key until dismissed', () => {
    const pin = { version: 1, signPublicKey: 'sign-1', acknowledged: true }
    const bumped = evaluateContactPin(pin, { version: 2, signPublicKey: 'sign-2' })
    expect(bumped).toMatchObject({ changed: true, write: true, pin: { version: 2, acknowledged: false } })
    // Same version, swapped key: the server is lying about an identity.
    expect(evaluateContactPin(pin, { version: 1, signPublicKey: 'other' }).changed).toBe(true)
    // Until the user dismisses it.
    expect(evaluateContactPin(bumped.pin, { version: 2, signPublicKey: 'sign-2' }).changed).toBe(true)
    expect(
      evaluateContactPin({ ...bumped.pin, acknowledged: true }, { version: 2, signPublicKey: 'sign-2' }).changed
    ).toBe(false)
  })

  it('drops verification when the safety code changes', () => {
    const pin = { version: 1, signPublicKey: 'k', acknowledged: true, verifiedSafetyCode: '11111 22222' }
    expect(isSafetyCodeVerified(pin, '11111 22222')).toBe(true)
    expect(isSafetyCodeVerified(pin, '99999 88888')).toBe(false)
    expect(isSafetyCodeVerified(undefined, '11111 22222')).toBe(false)
  })
})

describe('safety code QR', () => {
  it('round-trips the digits and rejects anything else', () => {
    const code = Array.from({ length: 12 }, (_, i) => String(10000 + i)).join(' ')
    expect(parseSafetyQr(safetyQrPayload(code))).toBe(code.replace(/ /g, ''))
    expect(parseSafetyQr('famlin-e2e-transfer:1:x')).toBeNull()
    expect(parseSafetyQr('famlin-e2e-safety:1:123')).toBeNull()
  })
})

describe('backup reminder', () => {
  const now = 1_000_000_000_000
  const day = 24 * 60 * 60 * 1000

  it('waits for five encrypted messages and a missing backup', () => {
    expect(shouldShowBackupReminder({ meta: { contacts: {}, encryptedSent: 4 }, hasBackup: false, now })).toBe(false)
    expect(shouldShowBackupReminder({ meta: { contacts: {}, encryptedSent: 5 }, hasBackup: false, now })).toBe(true)
    expect(shouldShowBackupReminder({ meta: { contacts: {}, encryptedSent: 50 }, hasBackup: true, now })).toBe(false)
    expect(shouldShowBackupReminder({ meta: { contacts: {} }, hasBackup: false, now })).toBe(false)
  })

  it('stays dismissed for 30 days', () => {
    const meta = (ago: number) => ({ contacts: {}, encryptedSent: 9, backupReminderDismissedAt: now - ago })
    expect(shouldShowBackupReminder({ meta: meta(29 * day), hasBackup: false, now })).toBe(false)
    expect(shouldShowBackupReminder({ meta: meta(30 * day), hasBackup: false, now })).toBe(true)
  })
})
