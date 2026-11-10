import { api } from './client'

// Diagnostic reports a member sends to their own server's admin (issue
// #357). Nothing here ever leaves that server: the admin decides whether to
// pass a report on.

export interface DiagnosticFrameStats {
  frames: number
  durationMs: number
  droppedFrames: number
  hitchMsPerSecond: number
  worstFrameMs: number
  p95FrameMs: number
}

/** The structured feed scroll report, as the mobile app records it. */
export interface FeedScrollReportData {
  device: string
  os: string
  app: string
  server: string
  refreshHz: number
  ui: DiagnosticFrameStats
  js: DiagnosticFrameStats
  content: {
    posts: number
    postsWithMedia: number
    multiMediaPosts: number
    mediaItems: number
    videos: number
    byType: Record<string, number>
  }
  imageLoads: { network: number; disk: number; memory: number }
}

export interface FeedScrollDiagnosticReport {
  kind: 'feed_scroll'
  platform: 'ios' | 'android'
  appVersion: string
  /** The plain-text report, exactly as the app shows and shares it. */
  text: string
  data: FeedScrollReportData
}

export type DiagnosticReportPayload = FeedScrollDiagnosticReport

export async function sendDiagnosticReport(report: DiagnosticReportPayload): Promise<void> {
  // requires-feature: diagnosticReports
  await api.post('/diagnostics/reports', report)
}
