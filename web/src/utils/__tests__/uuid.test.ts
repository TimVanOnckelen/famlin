import { randomUUID } from '../uuid'

afterEach(() => vi.unstubAllGlobals())

it('uses native randomUUID when available', () => {
  const native = vi.fn(() => '12345678-1234-4123-8123-123456789abc')
  vi.stubGlobal('crypto', { randomUUID: native })
  expect(randomUUID()).toBe('12345678-1234-4123-8123-123456789abc')
  expect(native).toHaveBeenCalledOnce()
})

it('generates RFC 4122 v4 UUIDs when randomUUID is unavailable over HTTP', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(0xff)
    return bytes
  })
  vi.stubGlobal('crypto', { getRandomValues })
  expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  expect(getRandomValues).toHaveBeenCalledOnce()
})
