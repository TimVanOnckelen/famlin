export interface ApiToken {
    id: string;
    name: string;
    tokenPreview: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
}
export interface CreatedApiToken extends ApiToken {
    /** Full secret (`famlin_pat_...`) — shown once, never retrievable again. */
    token: string;
}
export declare function fetchApiTokens(): Promise<ApiToken[]>;
export declare function createApiToken(body: {
    name: string;
    expiresInDays?: number;
}): Promise<CreatedApiToken>;
export declare function revokeApiToken(id: string): Promise<void>;
