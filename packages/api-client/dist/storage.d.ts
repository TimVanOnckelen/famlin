export interface StorageAdapter {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}
export declare function setStorageAdapter(a: StorageAdapter): void;
export declare function getStorageAdapter(): StorageAdapter;
export declare const TOKEN_KEY = "famlin_token";
export declare const SERVER_URL_KEY = "famlin_server_url";
