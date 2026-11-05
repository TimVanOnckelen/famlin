import type { ServerInfo } from './auth';
export type ServerFeature = 'circles' | 'stories' | 'giftLists' | 'uploadProcessing' | 'livePhotos' | 'deviceDiagnostics';
export declare const IMPLICIT_BASELINE_FEATURES: readonly ServerFeature[];
export declare function serverSupports(serverInfo: ServerInfo | null | undefined, feature: ServerFeature): boolean;
