import {
  IncomingSharedFile,
  SharedMediaItem,
  extensionForMimeType,
  fitSharedItems,
  isSupportedSharedMimeType,
  screenSharedFiles,
} from '@/utils/sharedMedia'

function file(mimeType: string | null, extra: Partial<IncomingSharedFile> = {}): IncomingSharedFile {
  return { path: 'file:///tmp/x', mimeType, fileName: 'x', width: null, height: null, duration: null, ...extra }
}

function item(name: string, extra: Partial<SharedMediaItem> = {}): SharedMediaItem {
  return {
    uri: name,
    mimeType: 'image/jpeg',
    fileName: name,
    isVideo: false,
    width: null,
    height: null,
    duration: null,
    ...extra,
  }
}

const items = (n: number) => Array.from({ length: n }, (_, i) => item(`${i}.jpg`))
const limits = { maxAttachments: 10, maxVideoDurationSeconds: 120 }

describe('fitSharedItems', () => {
  it('caps at the server limit: 0 existing + 12 shared → 10 attached, 2 skipped', () => {
    const shared = items(12)
    const { toAttach, skipped } = fitSharedItems(0, shared, limits)
    expect(toAttach).toEqual(shared.slice(0, 10))
    expect(skipped).toBe(2)
  })

  it('follows a raised server limit', () => {
    expect(fitSharedItems(0, items(12), { ...limits, maxAttachments: 30 }).skipped).toBe(0)
  })

  it('appends to an open draft within the cap: 7 existing + 5 shared → 3 attached, 2 skipped', () => {
    const shared = items(5)
    const { toAttach, skipped } = fitSharedItems(7, shared, limits)
    expect(toAttach).toEqual(shared.slice(0, 3))
    expect(skipped).toBe(2)
  })

  it('skips everything when the draft is already full (or over)', () => {
    expect(fitSharedItems(10, items(1), limits).skipped).toBe(1)
    expect(fitSharedItems(11, items(2), limits)).toEqual({ toAttach: [], skipped: 2, tooLong: 0 })
  })

  it('drops a video over the duration limit, but keeps one exactly at it or of unknown length', () => {
    const tooLong = item('a.mp4', { isVideo: true, duration: 120_001 })
    const atLimit = item('b.mp4', { isVideo: true, duration: 120_000 })
    const unknown = item('c.mp4', { isVideo: true })
    expect(fitSharedItems(0, [tooLong, atLimit, unknown], limits)).toEqual({
      toAttach: [atLimit, unknown],
      skipped: 0,
      tooLong: 1,
    })
    expect(fitSharedItems(0, [tooLong], { ...limits, maxVideoDurationSeconds: 300 }).tooLong).toBe(0)
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
    expect(screenSharedFiles(files)).toEqual({ accepted: files, unsupported: 0 })
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
