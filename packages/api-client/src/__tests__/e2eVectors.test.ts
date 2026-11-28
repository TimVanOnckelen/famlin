import { describe, expect, it } from 'vitest'
import {
  decryptAttachment,
  decryptMessage,
  fromBase64,
  openRecoveryBackup,
  openTransfer,
  publicIdentity,
  safetyCode,
} from '../e2e'
import v1 from './fixtures/e2e-v1.json'

// Frozen output of the v1 format, generated once and committed. NEVER
// regenerate or edit these fixtures: they stand in for messages, backups and
// transfers already stored on real servers. If a change makes one of these
// tests fail, the change breaks existing users' data — add a new format
// version instead (and a new fixture next to this one).

describe('e2e v1 fixtures stay readable', () => {
  it('decrypts the stored message for both participants', () => {
    for (const reader of [v1.tim, v1.mom]) {
      const content = decryptMessage({
        payload: v1.message,
        conversationId: v1.conversationId,
        authorId: v1.authorId,
        senderIdentity: publicIdentity(v1.mom),
        myKeys: [reader],
      })
      expect(content.mid).toBe('vector-mid')
      expect(content.text).toBe('Formats are forever — ✓ 🫶')
      expect(content.attachment).toMatchObject({ mime: 'image/jpeg', size: 1234, width: 4, height: 3 })
    }
  })

  it('opens the stored recovery backup', () => {
    expect(openRecoveryBackup(v1.recovery.backup, v1.recovery.code, publicIdentity(v1.tim))).toEqual(v1.tim)
  })

  it('opens the stored device transfer', () => {
    expect(openTransfer(v1.transfer.payload, v1.transfer.request, publicIdentity(v1.tim))).toEqual(v1.tim)
  })

  it('decrypts the stored attachment', () => {
    const bytes = decryptAttachment(fromBase64(v1.attachment.data), v1.attachment.key, v1.attachment.nonce)
    expect(new TextDecoder().decode(bytes)).toBe(v1.attachment.plaintext)
  })

  it('computes the same safety code', () => {
    expect(safetyCode(publicIdentity(v1.tim), publicIdentity(v1.mom))).toBe(v1.safetyCode)
  })
})
