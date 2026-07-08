import { OidcConfig, LoginResponse } from './auth';
export declare function generateRandomString(length?: number): string;
export declare function generateCodeChallenge(verifier: string): Promise<string>;
export declare function clearBrowserOidcLogin(): void;
export declare function startBrowserOidcLogin(config: OidcConfig, redirectUri: string): Promise<string>;
export declare function completeBrowserOidcLogin(code: string, state: string | null, redirectUri: string): Promise<LoginResponse>;
