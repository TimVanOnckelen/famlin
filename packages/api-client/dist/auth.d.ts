import { User, Group } from './types';
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
    appleSignInEnabled?: boolean;
}
export declare function fetchOidcConfig(): Promise<OidcConfig>;
export declare function loginWithOidc(idToken: string, inviteToken?: string): Promise<LoginResponse>;
export declare function loginWithApple(identityToken: string, fullName?: string, inviteToken?: string): Promise<LoginResponse>;
export declare function exchangeOidcMobileHandoff(code: string): Promise<LoginResponse>;
export declare function exchangeOidcCode(code: string, redirectUri: string, codeVerifier: string, inviteToken?: string): Promise<LoginResponse>;
export declare function loginWithPassword(email: string, password: string, inviteToken?: string): Promise<LoginResponse>;
export declare function fetchMe(): Promise<User & {
    groups: Group[];
}>;
export interface NotificationPrefs {
    emailOnNewPost?: boolean;
    emailOnNewComment?: boolean;
    emailOnNewLike?: boolean;
    pushOnNewPost?: boolean;
    pushOnNewComment?: boolean;
    pushOnNewLike?: boolean;
    pushOnStory?: boolean;
}
export interface UpdateMeBody extends NotificationPrefs {
    avatarUrl?: string | null;
}
export declare function updateMe(data: UpdateMeBody): Promise<User>;
export declare function fetchNotificationConfig(): Promise<{
    pushEnabled: boolean;
    emailEnabled: boolean;
}>;
export interface ServerInfo {
    version: string;
    minAppVersion?: string;
    appStoreUrl?: string | null;
    playStoreUrl?: string | null;
    readOnly?: boolean;
    branding?: Branding | null;
}
export interface BrandPalette {
    primary: string;
    primaryDark: string;
    primaryLight: string;
    primaryTint: string;
    bg: string;
    loginBgFrom: string;
    loginBgTo: string;
}
export interface BrandSemantic {
    accent: string;
    updateBg: string;
    circle: string;
    circleDark: string;
    circleTint: string;
    milestone: string;
    milestoneBg: string;
    milestoneText: string;
    milestoneDivider: string;
    trip: string;
    tripDark: string;
    tripBg: string;
    tripTint: string;
    tripBorder: string;
}
export interface Branding {
    name: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    palette: BrandPalette;
    semantic: BrandSemantic;
    hash: string;
}
export declare function getBrandingAssetUrl(path: string, serverUrl?: string | null): string;
export declare function fetchServerInfo(): Promise<ServerInfo>;
export declare function deleteAccount(): Promise<void>;
export declare function downloadMyExport(): Promise<Blob>;
export declare function getMyExportRequest(): Promise<{
    url: string;
    headers: Record<string, string>;
}>;
export declare function changePassword(currentPassword: string, newPassword: string): Promise<void>;
