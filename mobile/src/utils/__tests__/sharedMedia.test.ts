import {
  IncomingSharedFile,
  MAX_POST_ATTACHMENTS,
  extensionForMimeType,
  fitSharedItems,
  isSupportedSharedMimeType,
  screenSharedFiles,
} from '@/utils/sharedMedia'

function file(mimeType: string | null, extra: Partial<IncomingSharedFile> = {}): IncomingSharedFile {
  return { path: 'file:///tmp/x', mimeType, fileName: 'x', width: null, height: null, duration: null, ...extra }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('fitSharedItems', () => {
  it('caps at the composer limit: 0 existing + 12 shared → 10 attached, 2 skipped', () => {
    const { toAttach, skipped } = fitSharedItems(0, range(12))
    expect(MAX_POST_ATTACHMENTS).toBe(10)
    expect(toAttach).toEqual(range(10))
    expect(skipped).toBe(2)
  })

  it('appends to an open draft within the cap: 7 existing + 5 shared → 3 attached, 2 skipped', () => {
    const { toAttach, skipped } = fitSharedItems(7, ['a', 'b', 'c', 'd', 'e'])
    expect(toAttach).toEqual(['a', 'b', 'c'])
    expect(skipped).toBe(2)
  })

  it('attaches everything when it fits', () => {
    expect(fitSharedItems(2, ['a', 'b'])).toEqual({ toAttach: ['a', 'b'], skipped: 0 })
  })

  it('skips everything when the draft is already full (or over)', () => {
    expect(fitSharedItems(10, ['a'])).toEqual({ toAttach: [], skipped: 1 })
    expect(fitSharedItems(11, ['a', 'b'])).toEqual({ toAttach: [], skipped: 2 })
  })
})

describe('screenSharedFiles', () => {
  it('accepts a mix of photos and videos, in order', () => {
    const files = [
      file('image/jpeg'),
      file('video/mp4', { duration: 30_000 }),
      file('image/heic'),
      file('video/quicktime'),
    ]
    expect(screenSharedFiles(files)).toEqual({ accepted: files, unsupported: 0, tooLong: 0 })
  })

  it('rejects an unsupported mime type', () => {
    const files = [file('application/pdf'), file('image/jpeg'), file('image/svg+xml'), file(null)]
    const result = screenSharedFiles(files)
    expect(result.accepted).toEqual([files[1]])
    expect(result.unsupported).toBe(3)
  })

  it('rejects a file without a path', () => {
    expect(screenSharedFiles([file('image/jpeg', { path: '' })]).unsupported).toBe(1)
  })

  it('rejects a video over the picker duration limit, but keeps one exactly at it or of unknown length', () => {
    const tooLong = file('video/mp4', { duration: 120_001 })
    const atLimit = file('video/mp4', { duration: 120_000 })
    const unknown = file('video/mp4')
    const result = screenSharedFiles([tooLong, atLimit, unknown])
    expect(result.accepted).toEqual([atLimit, unknown])
    expect(result.tooLong).toBe(1)
  })
})

describe('mime helpers', () => {
  it('normalizes case and parameters', () => {
    expect(isSupportedSharedMimeType('IMAGE/JPEG')).toBe(true)
    expect(isSupportedSharedMimeType('video/mp4; codecs=avc1')).toBe(true)
    expect(isSupportedSharedMimeType('audio/mpeg')).toBe(false)
  })

  it('maps a mime type onto an extension the upload route accepts', () => {
    expect(extensionForMimeType('video/quicktime')).toBe('mov')
    expect(extensionForMimeType('image/jpeg')).toBe('jpg')
  })
})
