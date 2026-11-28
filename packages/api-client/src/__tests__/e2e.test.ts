import { describe, expect, it } from 'vitest'
import {
  createTransferRequest,
  decryptAttachment,
  decryptMessage,
  E2eError,
  encryptAttachment,
  encryptMessage,
  formatRecoveryCode,
  generateIdentity,
  generateRecoveryCode,
  newMessageId,
  normalizeRecoveryCode,
  openRecoveryBackup,
  openTransfer,
  parseTransferQr,
  publicIdentity,
  safetyCode,
  sealRecoveryBackup,
  sealTransfer,
  type E2eMessagePayloadV1,
} from '../e2e'
import { canonical, fromBase64, toBase64, utf8Decode, utf8Encode } from '../e2e/encoding'

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(E2eError)
    expect((error as E2eError).code).toBe(code)
    return
  }
  throw new Error(`expected E2eError(${code})`)
}

const mom = generateIdentity('user-mom', 1)
const tim = generateIdentity('user-tim', 1)
const eve = generateIdentity('user-eve', 1)
const conversationId = 'conv-1'

function send(text = 'Hallo schat') {
  return encryptMessage({
    conversationId,
    sender: mom,
    recipients: [publicIdentity(tim)],
    content: { mid: newMessageId(), text },
  })
}

describe('encoding', () => {
  it('round-trips base64 for every length remainder', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255)
      expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    }
    expect(toBase64(new TextEncoder().encode('Man'))).toBe('TWFu')
    expect(toBase64(new TextEncoder().encode('Ma'))).toBe('TWE=')
  })

  it('rejects malformed base64', () => {
    expect(() => fromBase64('abc')).toThrow()
    expect(() => fromBase64('ab$=')).toThrow()
  })

  it('length-prefixes fields so different splits never collide', () => {
    expect(canonical(['ab', 'c'])).not.toEqual(canonical(['a', 'bc']))
  })
})

describe('messages', () => {
  it('both participants can read a message; the signature binds the author', () => {
    const payload = send()
    expect(payload.keys.map((k) => k.userId)).toEqual(['user-mom', 'user-tim'])
    for (const reader of [tim, mom]) {
      const content = decryptMessage({
        payload,
        conversationId,
        authorId: 'user-mom',
        senderIdentity: publicIdentity(mom),
        myKeys: [reader],
      })
      expect(content.text).toBe('Hallo schat')
    }
  })

  it('a non-participant has no key', () => {
    expectCode(
      () =>
        decryptMessage({
          payload: send(),
          conversationId,
          authorId: 'user-mom',
          senderIdentity: publicIdentity(mom),
          myKeys: [eve],
        }),
      'no_key_for_me'
    )
  })

  it('finds the right key among several identity versions', () => {
    const timV2 = generateIdentity('user-tim', 2)
    const payload = encryptMessage({
      conversationId,
      sender: mom,
      recipients: [publicIdentity(timV2)],
      content: { mid: 'x', text: 'na reset' },
    })
    const content = decryptMessage({
      payload,
      conversationId,
      authorId: 'user-mom',
      senderIdentity: publicIdentity(mom),
      myKeys: [tim, timV2],
    })
    expect(content.text).toBe('na reset')
  })

  const tamperings: Array<[string, (p: E2eMessagePayloadV1) => unknown, string]> = [
    [
      'ciphertext',
      (p) => ({ ...p, ct: toBase64(fromBase64(p.ct).map((b, i) => (i === 0 ? b ^ 1 : b))) }),
      'bad_signature',
    ],
    ['a dropped key entry', (p) => ({ ...p, keys: p.keys.slice(1) }), 'bad_signature'],
    [
      'an added key entry for an eavesdropper',
      (p) => ({ ...p, keys: [...p.keys, { ...p.keys[0], userId: 'user-eve' }] }),
      'bad_signature',
    ],
    ['the signature', (p) => ({ ...p, sig: toBase64(new Uint8Array(64)) }), 'bad_signature'],
    ['the version', (p) => ({ ...p, v: 2 }), 'unknown_version'],
    ['the shape', () => ({ hello: 'world', v: 1 }), 'corrupt'],
    ['to null', () => null, 'corrupt'],
  ]
  it.each(tamperings)('rejects a payload with tampered %s', (_label, tamper, code) => {
    expectCode(
      () =>
        decryptMessage({
          payload: tamper(send()),
          conversationId,
          authorId: 'user-mom',
          senderIdentity: publicIdentity(mom),
          myKeys: [tim],
        }),
      code
    )
  })

  it('rejects a message moved to another conversation', () => {
    expectCode(
      () =>
        decryptMessage({
          payload: send(),
          conversationId: 'conv-2',
          authorId: 'user-mom',
          senderIdentity: publicIdentity(mom),
          myKeys: [tim],
        }),
      'bad_signature'
    )
  })

  it('rejects a message re-attributed to another author (a forged sender)', () => {
    // The server claims Eve wrote it and serves Eve's real key: signature fails.
    expectCode(
      () =>
        decryptMessage({
          payload: send(),
          conversationId,
          authorId: 'user-eve',
          senderIdentity: publicIdentity(eve),
          myKeys: [tim],
        }),
      'bad_signature'
    )
    // …and a message forged by someone holding only Tim's public key fails too.
    const forged = encryptMessage({
      conversationId,
      sender: eve,
      recipients: [publicIdentity(tim)],
      content: { mid: 'f', text: 'Stuur geld' },
    })
    expectCode(
      () =>
        decryptMessage({
          payload: { ...forged, senderKeyVersion: 1 },
          conversationId,
          authorId: 'user-mom',
          senderIdentity: publicIdentity(mom),
          myKeys: [tim],
        }),
      'bad_signature'
    )
  })

  it('requires the sender identity that matches the payload', () => {
    expectCode(
      () =>
        decryptMessage({
          payload: send(),
          conversationId,
          authorId: 'user-mom',
          senderIdentity: { ...publicIdentity(mom), version: 2 },
          myKeys: [tim],
        }),
      'sender_key_mismatch'
    )
  })

  it('carries an attachment reference', () => {
    const payload = encryptMessage({
      conversationId,
      sender: mom,
      recipients: [publicIdentity(tim)],
      content: {
        mid: 'm',
        attachment: { url: '/uploads/abc.bin', key: 'k', nonce: 'n', mime: 'image/jpeg', size: 12 },
      },
    })
    const content = decryptMessage({
      payload,
      conversationId,
      authorId: 'user-mom',
      senderIdentity: publicIdentity(mom),
      myKeys: [tim],
    })
    expect(content.attachment?.url).toBe('/uploads/abc.bin')
  })
})

describe('safety code', () => {
  it('is the same on both sides and changes when a key changes', () => {
    const a = safetyCode(publicIdentity(mom), publicIdentity(tim))
    expect(a).toBe(safetyCode(publicIdentity(tim), publicIdentity(mom)))
    expect(a).toMatch(/^(\d{5} ){11}\d{5}$/)
    expect(safetyCode(publicIdentity(mom), publicIdentity(generateIdentity('user-tim', 2)))).not.toBe(a)
  })
})

describe('recovery code', () => {
  it('is 8 groups of 4 unambiguous characters', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(formatRecoveryCode(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')))).toBe(code)
  })

  it('normalizes look-alikes and rejects bad input', () => {
    const code = '0000-1111-2222-3333-4444-5555-6666-7777'
    expect(normalizeRecoveryCode('oooo iiii 2222 3333 4444 5555 6666 7777'.replace('iiii', 'IlIl'))).toBe(
      code.replace(/-/g, '')
    )
    expectCode(() => normalizeRecoveryCode('too short'), 'invalid_recovery_code')
    expectCode(() => normalizeRecoveryCode('UUUU'.repeat(8)), 'invalid_recovery_code')
  })

  it('restores the identity with the right code only', () => {
    const code = generateRecoveryCode()
    const backup = sealRecoveryBackup(tim, code)
    expect(openRecoveryBackup(backup, code, publicIdentity(tim))).toEqual(tim)
    expectCode(() => openRecoveryBackup(backup, generateRecoveryCode(), publicIdentity(tim)), 'wrong_recovery_code')
  })

  it('refuses a backup that belongs to another identity', () => {
    const code = generateRecoveryCode()
    const backup = sealRecoveryBackup(eve, code)
    expectCode(() => openRecoveryBackup(backup, code, { ...publicIdentity(eve), version: 2 }), 'wrong_recovery_code')
    const evesKeysAsTim = sealRecoveryBackup({ ...eve, userId: 'user-tim' }, code)
    expectCode(() => openRecoveryBackup(evesKeysAsTim, code, publicIdentity(tim)), 'identity_mismatch')
  })
})

describe('device transfer', () => {
  it('hands the identity to the new device', () => {
    const request = createTransferRequest()
    const { sessionId, payload } = sealTransfer(tim, request.qr)
    expect(sessionId).toBe(request.sessionId)
    expect(openTransfer(payload, request, publicIdentity(tim))).toEqual(tim)
  })

  it('refuses keys that are not the published identity (a relay planting its own)', () => {
    const request = createTransferRequest()
    const { payload } = sealTransfer({ ...eve, userId: 'user-tim' }, request.qr)
    expectCode(() => openTransfer(payload, request, publicIdentity(tim)), 'identity_mismatch')
  })

  it('cannot be opened by anyone but the new device', () => {
    const request = createTransferRequest()
    const other = createTransferRequest()
    const { payload } = sealTransfer(tim, request.qr)
    expectCode(() => openTransfer(payload, { ...other, sessionId: request.sessionId }, publicIdentity(tim)), 'corrupt')
  })

  it('rejects malformed QR codes', () => {
    expectCode(() => parseTransferQr('https://example.com'), 'invalid_transfer_code')
    expectCode(() => parseTransferQr('famlin-e2e-transfer:1:short:abc'), 'invalid_transfer_code')
  })
})

describe('attachments', () => {
  it('round-trips and detects tampering', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i & 255)
    const { data, key, nonce } = encryptAttachment(bytes)
    expect(decryptAttachment(data, key, nonce)).toEqual(bytes)
    data[10] ^= 1
    expectCode(() => decryptAttachment(data, key, nonce), 'corrupt')
  })
})

describe('utf-8', () => {
  it('matches TextEncoder/TextDecoder on mixed text and rejects malformed bytes', () => {
    for (const text of ['', 'abc', 'héllo', '€ 中文', '🫶👨‍👩‍👧', 'x\u0000y']) {
      expect(utf8Encode(text)).toEqual(new TextEncoder().encode(text))
      expect(utf8Decode(new TextEncoder().encode(text))).toBe(text)
    }
    expect(utf8Encode('\ud800')).toEqual(new TextEncoder().encode('\ud800'))
    for (const bad of [[0xff], [0xc0, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
      expect(() => utf8Decode(Uint8Array.from(bad))).toThrow()
    }
  })
})
