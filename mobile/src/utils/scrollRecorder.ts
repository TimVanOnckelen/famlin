import type { ImageLoadStats } from '@/utils/scrollDiagnostics'

// The JS-thread half of the feed scroll diagnostics (issue #357): one
// recording at a time, held outside React so the feed list and its image
// tiles can report into it without subscribing to anything. Everything here
// is a no-op unless a recording is running.

/** Bounds a forgotten recording: ten minutes of frames at 120 Hz. */
export const MAX_RECORDED_FRAMES = 72000

/** How long after a finger lifts to wait for momentum before calling the scroll over. */
const DRAG_END_GRACE_MS = 150

interface Recording {
  jsFrames: number[]
  seenPostIds: Set<string>
  imageLoads: ImageLoadStats
  scrolling: boolean
  lastFrameAt: number | null
  rafId: number | null
  dragEndTimer: ReturnType<typeof setTimeout> | null
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

function clearDragEndTimer() {
  if (recording?.dragEndTimer) {
    clearTimeout(recording.dragEndTimer)
    recording.dragEndTimer = null
  }
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
    dragEndTimer: null,
    onScrollingChange,
  }
  recording.rafId = requestAnimationFrame(onFrame)
}

export function stopScrollRecording(): RecordingResult | null {
  const current = recording
  if (!current) return null
  clearDragEndTimer()
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
  onScrollBeginDrag: () => {
    clearDragEndTimer()
    setScrolling(true)
  },
  // A lifted finger either hands over to momentum or ends the scroll; only
  // the absence of a momentum event tells the two apart.
  onScrollEndDrag: () => {
    if (!recording) return
    clearDragEndTimer()
    recording.dragEndTimer = setTimeout(() => setScrolling(false), DRAG_END_GRACE_MS)
  },
  onMomentumScrollBegin: () => {
    clearDragEndTimer()
    setScrolling(true)
  },
  onMomentumScrollEnd: () => {
    clearDragEndTimer()
    setScrolling(false)
  },
  onViewableItemsChanged: ({ viewableItems }: { viewableItems: { key: string }[] }) => {
    if (!recording) return
    for (const token of viewableItems) {
      if (typeof token.key === 'string') recording.seenPostIds.add(token.key)
    }
  },
}
