import { usePendingShareStore } from '@/stores/pendingShareStore'
import type { SharedMediaItem } from '@/utils/sharedMedia'

function item(name: string, isVideo = false): SharedMediaItem {
  return {
    uri: `file:///cache/shared/${name}`,
    mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
    fileName: name,
    isVideo,
    width: null,
    height: null,
  }
}

describe('pendingShareStore', () => {
  beforeEach(() => usePendingShareStore.getState().clear())

  it('starts empty', () => {
    expect(usePendingShareStore.getState().share).toBeNull()
  })

  it('queues a share and hands it out exactly once', () => {
    const share = { items: [item('a.jpg'), item('b.mp4', true)], unsupported: 1, tooLong: 0 }
    usePendingShareStore.getState().addShare(share)

    expect(usePendingShareStore.getState().takeShare()).toEqual(share)
    expect(usePendingShareStore.getState().share).toBeNull()
    expect(usePendingShareStore.getState().takeShare()).toBeNull()
  })

  it('appends a second share that arrives before the first is consumed', () => {
    usePendingShareStore.getState().addShare({ items: [item('a.jpg')], unsupported: 1, tooLong: 0 })
    usePendingShareStore.getState().addShare({ items: [item('b.mp4', true)], unsupported: 0, tooLong: 2 })

    expect(usePendingShareStore.getState().takeShare()).toEqual({
      items: [item('a.jpg'), item('b.mp4', true)],
      unsupported: 1,
      tooLong: 2,
    })
  })

  it('clear drops a pending share', () => {
    usePendingShareStore.getState().addShare({ items: [item('a.jpg')], unsupported: 0, tooLong: 0 })
    usePendingShareStore.getState().clear()
    expect(usePendingShareStore.getState().share).toBeNull()
  })
})
