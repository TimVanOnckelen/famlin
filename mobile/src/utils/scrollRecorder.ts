import type { ImageLoadStats } from '@/utils/scrollDiagnostics'

// The JS-thread half of the feed scroll diagnostics (issue #357): one
// recording at a time, held outside React so the feed list and its image
// tiles can report into it without subscribing to anything. Everything here
// is a no-op unless a recording is running.

/** Bounds a forgotten recording: ten minutes of frames at 120 Hz. */
export const MAX_RECORDED_FRAMES = 72000

interface Recording {
  jsFrames: number[]
  seenPostIds: Set<string>
  imageLoads: ImageLoadStats
  scrolling: boolean
  lastFrameAt: number | null
  rafId: number | null
  onScrollingChange: (scrolling: boolean) => void
}

export interface RecordingResult {
  jsFrames: number[]
  seenPostIds: string[]
  imageLoads: ImageLoadStats
}

let recording: Recording | null = null

function setScrolling(scrolling: boolean) {
  if (!recording || recording.scrolling === scrolling) return
  recording.scrolling = scrolling
  recording.onScrollingChange(scrolling)
}

function onFrame(now: number) {
  const current = recording
  if (!current) return
  // Only frames produced while the list is moving count: an idle feed never
  // drops frames and would water the result down.
  if (current.scrolling && current.lastFrameAt !== null && current.jsFrames.length < MAX_RECORDED_FRAMES) {
    current.jsFrames.push(now - current.lastFrameAt)
  }
  current.lastFrameAt = now
  current.rafId = requestAnimationFrame(onFrame)
}

/**
 * Starts a recording. `onScrollingChange` mirrors the scrolling flag to the
 * caller, which uses it to gate its UI-thread frame counter.
 */
export function startScrollRecording(onScrollingChange: (scrolling: boolean) => void) {
  stopScrollRecording()
  recording = {
    jsFrames: [],
    seenPostIds: new Set(),
    imageLoads: { network: 0, disk: 0, memory: 0 },
    scrolling: false,
    lastFrameAt: null,
    rafId: null,
    onScrollingChange,
  }
  recording.rafId = requestAnimationFrame(onFrame)
}

export function stopScrollRecording(): RecordingResult | null {
  const current = recording
  if (!current) return null
  if (current.rafId !== null) cancelAnimationFrame(current.rafId)
  recording = null
  current.onScrollingChange(false)
  return {
    jsFrames: current.jsFrames,
    seenPostIds: [...current.seenPostIds],
    imageLoads: current.imageLoads,
  }
}

export function isScrollRecording(): boolean {
  return recording !== null
}

/** expo-image's `onLoad`, passed to feed tiles only while diagnostics are on. */
export function recordImageLoad(event: { cacheType: 'none' | 'disk' | 'memory' }) {
  if (!recording) return
  const source = event.cacheType === 'none' ? 'network' : event.cacheType
  if (source in recording.imageLoads) recording.imageLoads[source] += 1
}

/**
 * FlatList props that feed a recording. Module-level so their identity never
 * changes — FlatList refuses a new `onViewableItemsChanged` on the fly.
 */
export const scrollRecorderListProps = {
  onScrollBeginDrag: () => setScrolling(true),
  // A lifted finger either hands over to momentum or ends the scroll. Pause
  // right away and let momentum resume the count: waiting to see which it is
  // counted the frames of a list that had already stopped, and a 120 Hz
  // iPhone lowers its refresh rate for a still list, so every one of those
  // read as a dropped frame. The hand-over itself loses a frame or two at most.
  onScrollEndDrag: () => setScrolling(false),
  onMomentumScrollBegin: () => setScrolling(true),
  onMomentumScrollEnd: () => setScrolling(false),
  onViewableItemsChanged: ({ viewableItems }: { viewableItems: { key: string }[] }) => {
    if (!recording) return
    for (const token of viewableItems) {
      if (typeof token.key === 'string') recording.seenPostIds.add(token.key)
    }
  },
}
