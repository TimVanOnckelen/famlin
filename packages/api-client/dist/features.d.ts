import type { ServerInfo } from './auth';
export type ServerFeature = 'accountDeletion' | 'circles' | 'stories' | 'memberExport' | 'giftLists' | 'uploadProcessing' | 'livePhotos' | 'deviceDiagnostics' | 'wiki' | 'diagnosticReports' | 'giftListGuests';
export declare const IMPLICIT_BASELINE_FEATURES: readonly ServerFeature[];
export declare const PRE_FEATURE_LIST_FEATURES: readonly ServerFeature[];
export declare function serverSupports(serverInfo: ServerInfo | null | undefined, feature: ServerFeature): boolean;
export type FeatureSupport = 'supported' | 'unsupported' | 'unknown';
export declare function serverFeatureSupport(serverInfo: ServerInfo | null | undefined, feature: ServerFeature): FeatureSupport;
export declare function isNotFoundError(error: unknown): boolean;
