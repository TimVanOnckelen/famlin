export declare function setApiBaseUrl(serverUrl: string): void;
export declare function getCurrentServerUrl(): string | null;
export declare function setMediaToken(token: string | null): void;
export declare function getCurrentMediaToken(): string | null;
export declare function initApiBaseUrl(): Promise<void>;
export declare const api: import("axios").AxiosInstance;
export declare function setUnauthorizedHandler(fn: () => void): void;
