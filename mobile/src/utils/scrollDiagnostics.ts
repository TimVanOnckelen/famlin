import { isVideoUrl } from '@/utils/media'

// Pure maths behind the hidden feed scroll diagnostics (issue #357): turns
// per-frame durations into numbers a tester can paste into an issue, so a
// change to the feed can be judged without Xcode or a drawer of test phones.

/** Display refresh intervals a phone can run a scroll at (120, 90 and 60 Hz). */
const REFRESH_INTERVALS_MS = [1000 / 120, 1000 / 90, 1000 / 60]

/** A frame counts as a hitch once it runs this far past the refresh interval. */
const HITCH_THRESHOLD = 1.5

export interface FrameStats {
  frames: number
  /** Scrolling time covered by the recorded frames. */
  durationMs: number
  /** Refresh intervals that passed without a new frame. */
  droppedFrames: number
  /** Milliseconds of hitch per second of scrolling — Apple's "hitch time ratio". */
  hitchMsPerSecond: number
  worstFrameMs: number
  p95FrameMs: number
  /**
   * Late frames by how many refreshes each one missed. Many isolated
   * one-refresh misses with no longer ones look like a 120 Hz display
   * stepping its rate down; real stalls (mounting a card, decoding a photo)
   * miss several in a row.
   */
  lateFrames: { missedOne: number; missedTwoToThree: number; missedFourPlus: number }
}

export type ScrollRating = 'good' | 'warning' | 'critical'

export interface ContentStats {
  posts: number
  postsWithMedia: number
  /** Posts showing more than one photo/video (collage or gallery). */
  multiMediaPosts: number
  mediaItems: number
  videos: number
  byType: Record<string, number>
}

/** Where expo-image got each image that finished loading mid-recording. */
export interface ImageLoadStats {
  network: number
  disk: number
  memory: number
}

export interface ScrollReport {
  device: string
  os: string
  app: string
  server: string
  refreshHz: number
  /** The JS thread's frame-loop rate, when it differs from `refreshHz`. */
  jsRefreshHz?: number
  ui: FrameStats
  js: FrameStats
  content: ContentStats
  imageLoads: ImageLoadStats
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

/**
 * The refresh interval the scroll ran at, taken from the fastest frames: a
 * stuttering list still produces on-time frames in between, so the 10th
 * percentile shows the display's rate where a median would show the stutter.
 */
export function estimateFrameIntervalMs(durations: number[]): number {
  const valid = durations.filter((d) => d > 0).sort((a, b) => a - b)
  if (valid.length === 0) return 1000 / 60
  const fast = percentile(valid, 0.1)
  return REFRESH_INTERVALS_MS.reduce((best, candidate) =>
    Math.abs(candidate - fast) < Math.abs(best - fast) ? candidate : best
  )
}

/**
 * The interval the JS thread's frame loop ticks at. React Native's
 * `requestAnimationFrame` isn't tied to the display's rate: on a 120 Hz
 * iPhone it ticks at 60 Hz while the UI thread runs at 120, so judging its
 * frames against the display interval reports every tick as a dropped frame
 * (issue #357's first report: 496 ms/s "hitches" with a p95 of 17 ms and no
 * frame over 23 ms). Its own rate comes from its own on-time frames, never
 * faster than the display's.
 */
export function estimateJsFrameIntervalMs(jsDurations: number[], displayIntervalMs: number): number {
  if (jsDurations.length === 0) return displayIntervalMs
  return Math.max(displayIntervalMs, estimateFrameIntervalMs(jsDurations))
}

export function summarizeFrames(durations: number[], frameIntervalMs: number): FrameStats {
  const valid = durations.filter((d) => d > 0)
  const durationMs = valid.reduce((sum, d) => sum + d, 0)
  let droppedFrames = 0
  let hitchMs = 0
  const lateFrames = { missedOne: 0, missedTwoToThree: 0, missedFourPlus: 0 }
  for (const d of valid) {
    if (d > frameIntervalMs * HITCH_THRESHOLD) {
      const missed = Math.round(d / frameIntervalMs) - 1
      droppedFrames += missed
      hitchMs += d - frameIntervalMs
      if (missed <= 1) lateFrames.missedOne += 1
      else if (missed <= 3) lateFrames.missedTwoToThree += 1
      else lateFrames.missedFourPlus += 1
    }
  }
  const sorted = [...valid].sort((a, b) => a - b)
  return {
    frames: valid.length,
    durationMs,
    droppedFrames,
    hitchMsPerSecond: durationMs > 0 ? hitchMs / (durationMs / 1000) : 0,
    worstFrameMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    p95FrameMs: percentile(sorted, 0.95),
    lateFrames,
  }
}

/** Apple's thresholds for the hitch time ratio: under 5 ms/s is unnoticeable, over 10 is a visible problem. */
export function rateHitches(hitchMsPerSecond: number): ScrollRating {
  if (hitchMsPerSecond < 5) return 'good'
  if (hitchMsPerSecond <= 10) return 'warning'
  return 'critical'
}

export function summarizeContent(posts: { type: string; uploadedAssetUrls: string[] }[]): ContentStats {
  const stats: ContentStats = {
    posts: posts.length,
    postsWithMedia: 0,
    multiMediaPosts: 0,
    mediaItems: 0,
    videos: 0,
    byType: {},
  }
  for (const post of posts) {
    const urls = post.uploadedAssetUrls ?? []
    stats.byType[post.type] = (stats.byType[post.type] ?? 0) + 1
    if (urls.length > 0) stats.postsWithMedia += 1
    if (urls.length > 1) stats.multiMediaPosts += 1
    stats.mediaItems += urls.length
    stats.videos += urls.filter(isVideoUrl).length
  }
  return stats
}

function lateFramesSuffix({ lateFrames }: FrameStats): string {
  // Reports recorded before the breakdown existed (or rebuilt from stored data) lack it.
  if (!lateFrames) return ''
  const { missedOne, missedTwoToThree, missedFourPlus } = lateFrames
  if (missedOne + missedTwoToThree + missedFourPlus === 0) return ''
  return `; late frames missing 1/2-3/4+ refreshes: ${missedOne}/${missedTwoToThree}/${missedFourPlus}`
}

function frameLine(label: string, stats: FrameStats): string {
  return (
    `${label}: ${stats.hitchMsPerSecond.toFixed(1)} ms/s hitches (${rateHitches(stats.hitchMsPerSecond)}), ` +
    `${stats.droppedFrames} dropped of ${stats.frames + stats.droppedFrames} frames, ` +
    `worst ${stats.worstFrameMs.toFixed(0)} ms, p95 ${stats.p95FrameMs.toFixed(1)} ms` +
    lateFramesSuffix(stats)
  )
}

/**
 * The text a tester shares. Always English, since it is pasted into a GitHub
 * issue, and deliberately free of anything identifying: no server address,
 * account or post content.
 */
export function formatScrollReport(report: ScrollReport): string {
  const { content, imageLoads } = report
  const types = Object.entries(content.byType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type} ${count}`)
    .join(', ')
  return [
    'Famlin scroll diagnostics',
    `Device: ${report.device} · ${report.os}`,
    `App: ${report.app} · Server: ${report.server}`,
    `Scrolled: ${(report.ui.durationMs / 1000).toFixed(1)} s at ${report.refreshHz} Hz`,
    frameLine('UI thread', report.ui),
    frameLine(
      report.jsRefreshHz && report.jsRefreshHz !== report.refreshHz
        ? `JS thread (${report.jsRefreshHz} Hz ticks)`
        : 'JS thread',
      report.js
    ),
    `Posts seen: ${content.posts} (${types || 'none'})`,
    `Media: ${content.mediaItems} items in ${content.postsWithMedia} posts, ` +
      `${content.multiMediaPosts} multi-photo posts, ${content.videos} videos`,
    `Images loaded while recording: ${imageLoads.network} network, ${imageLoads.disk} disk, ${imageLoads.memory} memory`,
  ].join('\n')
}
