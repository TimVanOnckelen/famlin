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

export function summarizeFrames(durations: number[], frameIntervalMs: number): FrameStats {
  const valid = durations.filter((d) => d > 0)
  const durationMs = valid.reduce((sum, d) => sum + d, 0)
  let droppedFrames = 0
  let hitchMs = 0
  for (const d of valid) {
    if (d > frameIntervalMs * HITCH_THRESHOLD) {
      droppedFrames += Math.round(d / frameIntervalMs) - 1
      hitchMs += d - frameIntervalMs
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

function frameLine(label: string, stats: FrameStats): string {
  return (
    `${label}: ${stats.hitchMsPerSecond.toFixed(1)} ms/s hitches (${rateHitches(stats.hitchMsPerSecond)}), ` +
    `${stats.droppedFrames} dropped of ${stats.frames + stats.droppedFrames} frames, ` +
    `worst ${stats.worstFrameMs.toFixed(0)} ms, p95 ${stats.p95FrameMs.toFixed(1)} ms`
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
    frameLine('JS thread', report.js),
    `Posts seen: ${content.posts} (${types || 'none'})`,
    `Media: ${content.mediaItems} items in ${content.postsWithMedia} posts, ` +
      `${content.multiMediaPosts} multi-photo posts, ${content.videos} videos`,
    `Images loaded while recording: ${imageLoads.network} network, ${imageLoads.disk} disk, ${imageLoads.memory} memory`,
  ].join('\n')
}
