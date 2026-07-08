import { User } from './types';
export interface LoginResponse {
    token: string;
    user: User;
}
export interface OidcConfig {
    enabled: boolean;
    name: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    scopes: string;
    usesClientSecret: boolean;
    mobileCallbackUrl?: string;
}
export declare function fetchOidcConfig(): Promise<OidcConfig>;
export declare function loginWithOidc(idToken: string, inviteToken?: string): Promise<LoginResponse>;
export declare function exchangeOidcMobileHandoff(code: string): Promise<LoginResponse>;
export declare function exchangeOidcCode(code: string, redirectUri: string, codeVerifier: string, inviteToken?: string): Promise<LoginResponse>;
export declare function loginWithPassword(email: string, password: string, inviteToken?: string): Promise<LoginResponse>;
export declare function fetchMe(): Promise<User & {
    groups: any[];
}>;
export interface NotificationPrefs {
    emailOnNewPost?: boolean;
    emailOnNewComment?: boolean;
    emailOnNewLike?: boolean;
    pushOnNewPost?: boolean;
    pushOnNewComment?: boolean;
    pushOnNewLike?: boolean;
}
export interface UpdateMeBody extends NotificationPrefs {
    avatarUrl?: string | null;
}
export declare function updateMe(data: UpdateMeBody): Promise<User>;
export declare function fetchNotificationConfig(): Promise<{
    pushEnabled: boolean;
    emailEnabled: boolean;
}>;
export declare function fetchServerInfo(): Promise<{
    version: string;
}>;
