import {
  isScrollRecording,
  recordImageLoad,
  scrollRecorderListProps as list,
  startScrollRecording,
  stopScrollRecording,
} from '@/utils/scrollRecorder'

// Drive requestAnimationFrame by hand so each test decides when a frame lands.
let frames: ((now: number) => void)[] = []
function frame(now: number) {
  const pending = frames
  frames = []
  pending.forEach((callback) => callback(now))
}

beforeEach(() => {
  jest.useFakeTimers()
  frames = []
  globalThis.requestAnimationFrame = ((callback: (now: number) => void) => frames.push(callback)) as any
  globalThis.cancelAnimationFrame = (() => {
    frames = []
  }) as any
})

afterEach(() => {
  stopScrollRecording()
  jest.useRealTimers()
})

const viewable = (...keys: string[]) => ({ viewableItems: keys.map((key) => ({ key })) as any })

it('does nothing while no recording is running', () => {
  list.onScrollBeginDrag()
  list.onViewableItemsChanged(viewable('p1'))
  recordImageLoad({ cacheType: 'none' })
  expect(isScrollRecording()).toBe(false)
  expect(stopScrollRecording()).toBeNull()
})

it('counts JS frames only while the list is moving', () => {
  const onScrollingChange = jest.fn()
  startScrollRecording(onScrollingChange)

  frame(0)
  frame(16) // idle: not counted
  list.onScrollBeginDrag()
  frame(32)
  frame(82) // a 50 ms hitch
  list.onMomentumScrollEnd()
  frame(98) // idle again

  expect(onScrollingChange.mock.calls).toEqual([[true], [false]])
  expect(stopScrollRecording()?.jsFrames).toEqual([16, 50])
})

it('resumes counting when momentum takes over from a drag', () => {
  const onScrollingChange = jest.fn()
  startScrollRecording(onScrollingChange)

  list.onScrollBeginDrag()
  list.onScrollEndDrag()
  list.onMomentumScrollBegin()
  expect(onScrollingChange.mock.calls).toEqual([[true], [false], [true]])

  list.onMomentumScrollEnd()
  expect(onScrollingChange.mock.calls).toEqual([[true], [false], [true], [false]])
})

it('stops counting the moment a drag is released without momentum', () => {
  startScrollRecording(jest.fn())

  frame(0)
  list.onScrollBeginDrag()
  frame(8)
  list.onScrollEndDrag()
  frame(25) // the list is already still: not counted
  frame(42)

  expect(stopScrollRecording()?.jsFrames).toEqual([8])
})

it('collects the posts scrolled past and where their images came from', () => {
  startScrollRecording(jest.fn())
  list.onViewableItemsChanged(viewable('p1', 'p2'))
  list.onViewableItemsChanged(viewable('p2', 'p3'))
  recordImageLoad({ cacheType: 'none' })
  recordImageLoad({ cacheType: 'disk' })
  recordImageLoad({ cacheType: 'disk' })

  const result = stopScrollRecording()
  expect(result?.seenPostIds).toEqual(['p1', 'p2', 'p3'])
  expect(result?.imageLoads).toEqual({ network: 1, disk: 2, memory: 0 })
})

it('tells the caller scrolling stopped when a recording ends mid-scroll', () => {
  const onScrollingChange = jest.fn()
  startScrollRecording(onScrollingChange)
  list.onScrollBeginDrag()
  stopScrollRecording()
  expect(onScrollingChange.mock.calls).toEqual([[true], [false]])
  expect(isScrollRecording()).toBe(false)
})
