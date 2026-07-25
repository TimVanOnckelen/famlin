export declare function getUploadUrl(path: string, variant?: 'thumbnail'): string;
export declare const UPLOAD_TIMEOUT_MS: number;
export declare function uploadFiles(files: File[]): Promise<string[]>;
export declare function refreshMediaToken(): Promise<void>;
export declare function ensureFreshMediaToken(): Promise<void>;
