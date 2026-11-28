import { encodeQr } from '@/utils/qrCode'

let QRCode: any = null
try {
  // Only present when the root workspace is installed.
  QRCode = require('../../../../node_modules/qrcode')
} catch {
  QRCode = null
}

const maybe = QRCode ? it : it.skip

describe('encodeQr', () => {
  it('draws the finder patterns and sizes by version', () => {
    const { size, modules } = encodeQr('hello')
    expect(size).toBe(21)
    expect(modules[0].slice(0, 7).every(Boolean)).toBe(true)
    expect(modules[3][3]).toBe(true)
    expect(modules[1][1]).toBe(false)
  })

  it('grows the version with the text and rejects what cannot fit', () => {
    expect(encodeQr('x'.repeat(100)).size).toBe(37)
    expect(() => encodeQr('x'.repeat(400))).toThrow('too long')
  })

  maybe.each([
    'famlin-e2e-transfer:1:Ab3-_x9QkLm0Zp7Rt2Yw:c2FtcGxlLXB1YmxpYy1rZXktYmFzZTY0LXRleHQ=',
    'famlin-e2e-safety:1:Hello World',
    'abc',
    'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog, again & again.',
    'Mixed Case Text with symbols !@#$%^&*() '.repeat(4),
  ])('matches the qrcode package for %s', (text: string) => {
    const reference = QRCode.create(text, { errorCorrectionLevel: 'L', maskPattern: 0 })
    const mine = encodeQr(text)
    expect(mine.size).toBe(reference.modules.size)
    const flat = mine.modules.flat().map((dark: boolean) => (dark ? 1 : 0))
    expect(flat).toEqual(Array.from(reference.modules.data as Uint8Array))
  })
})
