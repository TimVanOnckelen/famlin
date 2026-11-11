export interface ApiToken {
    id: string;
    name: string;
    tokenPreview: string;
    /**
     * Whether the token may use its owner's admin rights. Without it the token
     * acts as an ordinary member, even for an admin. Absent on servers that
     * predate the flag, where every token of an admin had admin rights.
     */
    adminAccess?: boolean;
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
    adminAccess?: boolean;
}): Promise<CreatedApiToken>;
export declare function revokeApiToken(id: string): Promise<void>;
