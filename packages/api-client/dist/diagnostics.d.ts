export interface DiagnosticFrameStats {
    frames: number;
    durationMs: number;
    droppedFrames: number;
    hitchMsPerSecond: number;
    worstFrameMs: number;
    p95FrameMs: number;
}
/** The structured feed scroll report, as the mobile app records it. */
export interface FeedScrollReportData {
    device: string;
    os: string;
    app: string;
    server: string;
    refreshHz: number;
    ui: DiagnosticFrameStats;
    js: DiagnosticFrameStats;
    content: {
        posts: number;
        postsWithMedia: number;
        multiMediaPosts: number;
        mediaItems: number;
        videos: number;
        byType: Record<string, number>;
    };
    imageLoads: {
        network: number;
        disk: number;
        memory: number;
    };
}
export interface FeedScrollDiagnosticReport {
    kind: 'feed_scroll';
    platform: 'ios' | 'android';
    appVersion: string;
    /** The plain-text report, exactly as the app shows and shares it. */
    text: string;
    data: FeedScrollReportData;
}
export type DiagnosticReportPayload = FeedScrollDiagnosticReport;
export declare function sendDiagnosticReport(report: DiagnosticReportPayload): Promise<void>;
