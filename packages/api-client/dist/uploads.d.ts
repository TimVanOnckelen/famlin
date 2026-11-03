export declare function getUploadUrl(path: string, variant?: 'thumbnail'): string;
export declare const UPLOAD_TIMEOUT_MS: number;
export interface UploadSessionMedia extends UploadProcessing {
    url: string;
}
export interface UploadResult {
    urls: string[];
    sessionMedia?: UploadSessionMedia[];
}
export declare function uploadFiles(files: File[], onProgress?: (fraction: number) => void): Promise<string[]>;
export declare function uploadFilesInSession(files: File[], sessionId: string, excludedKeys?: string[]): Promise<UploadResult>;
export declare function refreshMediaToken(): Promise<void>;
export declare function ensureFreshMediaToken(): Promise<void>;
export interface UploadProcessing {
    kind?: 'image' | 'video' | 'livePhoto';
    videoUrl?: string | null;
    status: 'queued' | 'processing' | 'ready' | 'failed';
    url: string | null;
    thumbnailUrl: string | null;
}
export declare function uploadKey(url: string): string | null;
export declare function fetchUploadProcessing(assetKey: string): Promise<UploadProcessing>;
