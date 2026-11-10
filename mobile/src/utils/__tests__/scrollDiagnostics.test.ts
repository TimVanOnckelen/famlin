import {
  estimateFrameIntervalMs,
  formatScrollReport,
  rateHitches,
  summarizeContent,
  summarizeFrames,
} from '@/utils/scrollDiagnostics'

const FRAME_60 = 1000 / 60
const FRAME_120 = 1000 / 120

describe('estimateFrameIntervalMs', () => {
  it('reads the refresh rate from the on-time frames, not the stutter', () => {
    // Mostly hitching, but the fast frames still give the display away.
    const durations = [...Array(40).fill(50), ...Array(20).fill(16.6)]
    expect(estimateFrameIntervalMs(durations)).toBeCloseTo(FRAME_60)
  })

  it('recognises a 120 Hz scroll', () => {
    expect(estimateFrameIntervalMs(Array(100).fill(8.4))).toBeCloseTo(FRAME_120)
  })

  it('assumes 60 Hz when nothing was recorded', () => {
    expect(estimateFrameIntervalMs([])).toBeCloseTo(FRAME_60)
  })
})

describe('summarizeFrames', () => {
  it('reports a smooth scroll as free of hitches', () => {
    const stats = summarizeFrames(Array(120).fill(FRAME_60), FRAME_60)
    expect(stats.frames).toBe(120)
    expect(stats.durationMs).toBeCloseTo(2000)
    expect(stats.droppedFrames).toBe(0)
    expect(stats.hitchMsPerSecond).toBe(0)
  })

  it('counts the refresh intervals a long frame swallowed', () => {
    // 57 on-time frames plus one that took three intervals: one second in all.
    const stats = summarizeFrames([...Array(57).fill(FRAME_60), FRAME_60 * 3], FRAME_60)
    expect(stats.droppedFrames).toBe(2)
    expect(stats.durationMs).toBeCloseTo(1000)
    expect(stats.hitchMsPerSecond).toBeCloseTo(FRAME_60 * 2)
    expect(stats.worstFrameMs).toBeCloseTo(FRAME_60 * 3)
  })

  it('ignores ordinary timing jitter', () => {
    const stats = summarizeFrames([15, 18, 17, 16, 20], FRAME_60)
    expect(stats.droppedFrames).toBe(0)
    expect(stats.hitchMsPerSecond).toBe(0)
  })

  it('survives an empty recording', () => {
    expect(summarizeFrames([], FRAME_60)).toEqual({
      frames: 0,
      durationMs: 0,
      droppedFrames: 0,
      hitchMsPerSecond: 0,
      worstFrameMs: 0,
      p95FrameMs: 0,
    })
  })
})

it('rates hitches on Apple’s thresholds', () => {
  expect(rateHitches(0)).toBe('good')
  expect(rateHitches(4.9)).toBe('good')
  expect(rateHitches(7)).toBe('warning')
  expect(rateHitches(10.1)).toBe('critical')
})

it('summarises what was scrolled past', () => {
  const stats = summarizeContent([
    { type: 'UPDATE', uploadedAssetUrls: [] },
    { type: 'UPDATE', uploadedAssetUrls: ['/uploads/a.jpg'] },
    { type: 'MILESTONE', uploadedAssetUrls: ['/uploads/b.jpg', '/uploads/c.mp4', '/uploads/d.jpg'] },
  ])
  expect(stats).toEqual({
    posts: 3,
    postsWithMedia: 2,
    multiMediaPosts: 1,
    mediaItems: 4,
    videos: 1,
    byType: { UPDATE: 2, MILESTONE: 1 },
  })
})

it('formats a report without anything identifying', () => {
  const frames = summarizeFrames([...Array(57).fill(FRAME_60), FRAME_60 * 3], FRAME_60)
  const text = formatScrollReport({
    device: 'iPhone 13',
    os: 'iOS 26.1',
    app: '1.2.3 (45)',
    server: '0.9.0',
    refreshHz: 60,
    ui: frames,
    js: summarizeFrames(Array(60).fill(FRAME_60), FRAME_60),
    content: summarizeContent([{ type: 'UPDATE', uploadedAssetUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] }]),
    imageLoads: { network: 2, disk: 1, memory: 0 },
  })
  expect(text).toContain('Device: iPhone 13 · iOS 26.1')
  expect(text).toContain('Scrolled: 1.0 s at 60 Hz')
  expect(text).toContain('UI thread: 33.3 ms/s hitches (critical), 2 dropped of 60 frames')
  expect(text).toContain('JS thread: 0.0 ms/s hitches (good), 0 dropped of 60 frames')
  expect(text).toContain('Posts seen: 1 (UPDATE 1)')
  expect(text).toContain('Media: 2 items in 1 posts, 1 multi-photo posts, 0 videos')
  expect(text).toContain('Images loaded while recording: 2 network, 1 disk, 0 memory')
  expect(text).not.toContain('/uploads/')
})
